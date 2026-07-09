import { google } from '@ai-sdk/google';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';

async function main() {
  const result = streamText({
    model: google('gemini-3.1-flash-lite-preview'),
    abortSignal: AbortSignal.timeout(60_000),
    stopWhen: stepCountIs(3),
    tools: {
      get_weather: tool({
        description: 'Get the current weather for a given city.',
        inputSchema: z.object({ city: z.string() }),
        execute: async ({ city }) => ({
          city,
          tempC: city === 'Paris' ? 21 : city === 'Tokyo' ? 24 : 19,
          conditions: 'sunny',
        }),
      }),
    },
    prompt:
      'Use the get_weather tool to check the weather in Paris, Tokyo, and New York. Make exactly three get_weather tool calls in parallel in the same assistant step before you summarize.',
  });

  for await (const _ of result.textStream) {
    // drain
  }

  const warnings = await result.warnings;
  const steps = await result.steps;

  console.log('WARNINGS:');
  console.log(JSON.stringify(warnings, null, 2));

  console.log('\nTOOL-CALL PARTS:');
  let toolCallCount = 0;
  let signedToolCallCount = 0;
  let unsignedToolCallCount = 0;

  for (const [stepIndex, step] of steps.entries()) {
    for (const part of step.content) {
      if (part.type !== 'tool-call') {
        continue;
      }

      toolCallCount++;
      const thoughtSignature =
        (
          part.providerMetadata as
            | { vertex?: { thoughtSignature?: unknown } }
            | null
            | undefined
        )?.vertex?.thoughtSignature ??
        (
          part.providerMetadata as
            | { google?: { thoughtSignature?: unknown } }
            | null
            | undefined
        )?.google?.thoughtSignature ??
        (
          part.providerMetadata as
            | { googleVertex?: { thoughtSignature?: unknown } }
            | null
            | undefined
        )?.googleVertex?.thoughtSignature;

      if (thoughtSignature == null) {
        unsignedToolCallCount++;
      } else {
        signedToolCallCount++;
      }

      console.log(
        [
          `step[${stepIndex}]`,
          `tool-call=${part.toolName}`,
          `thoughtSignature=${thoughtSignature == null ? 'ABSENT' : 'PRESENT'}`,
          `providerMetadata=${JSON.stringify(part.providerMetadata ?? null)}`,
        ].join(' '),
      );
    }
  }

  const warningText = JSON.stringify(warnings);
  const fixed =
    toolCallCount >= 3 &&
    signedToolCallCount >= 1 &&
    unsignedToolCallCount >= 2 &&
    !warningText.includes('skip_thought_signature_validator');

  console.log('\nSUMMARY:');
  console.log(
    JSON.stringify(
      {
        toolCallCount,
        signedToolCallCount,
        unsignedToolCallCount,
        hasSkipThoughtSignatureValidatorWarning: warningText.includes(
          'skip_thought_signature_validator',
        ),
        fixed,
      },
      null,
      2,
    ),
  );

  if (!fixed) {
    throw new Error(
      'Expected at least three parallel Gemini 3 tool calls with one signed call, at least two unsigned calls, and no skip_thought_signature_validator warning.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
