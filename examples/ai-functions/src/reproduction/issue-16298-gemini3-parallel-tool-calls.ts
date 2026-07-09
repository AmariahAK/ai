import { google } from '@ai-sdk/google';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';

async function main() {
  const result = streamText({
    model: google('gemini-3.1-flash-lite-preview'),
    abortSignal: AbortSignal.timeout(120_000),
    stopWhen: stepCountIs(5),
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

  const finalText = await result.text;
  const warnings = await result.warnings;
  const steps = await result.steps;

  console.log('WARNINGS:');
  console.log(JSON.stringify(warnings, null, 2));

  console.log('\nFINAL TEXT:');
  console.log(finalText);

  console.log('\nTOOL-CALL PARTS:');
  let toolCallCount = 0;
  let signedToolCallCount = 0;
  let unsignedToolCallCount = 0;
  let toolResultCount = 0;
  let multiStepRoundtrip = false;

  for (const [stepIndex, step] of steps.entries()) {
    const stepToolCallCount = step.content.filter(
      part => part.type === 'tool-call',
    ).length;
    const stepToolResultCount = step.content.filter(
      part => part.type === 'tool-result',
    ).length;

    if (stepToolCallCount >= 3 && stepToolResultCount >= 3) {
      multiStepRoundtrip =
        multiStepRoundtrip ||
        steps
          .slice(stepIndex + 1)
          .some(laterStep =>
            laterStep.content.some(
              part => part.type === 'text' && part.text.trim().length > 0,
            ),
          );
    }

    for (const part of step.content) {
      if (part.type === 'tool-result') {
        toolResultCount++;
        continue;
      }

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
    toolResultCount >= 3 &&
    signedToolCallCount >= 1 &&
    unsignedToolCallCount >= 2 &&
    multiStepRoundtrip &&
    !warningText.includes('skip_thought_signature_validator');

  console.log('\nSUMMARY:');
  console.log(
    JSON.stringify(
      {
        stepCount: steps.length,
        toolCallCount,
        toolResultCount,
        signedToolCallCount,
        unsignedToolCallCount,
        finalTextPresent: finalText.trim().length > 0,
        multiStepRoundtrip,
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
      'Expected a Gemini 3 multi-step roundtrip with at least three parallel tool calls, matching tool results, one signed call, at least two unsigned calls, final text, and no skip_thought_signature_validator warning.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
