import { createGateway, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';

function readThoughtSignature(providerMetadata: unknown): string | undefined {
  if (providerMetadata == null || typeof providerMetadata !== 'object') {
    return undefined;
  }

  for (const namespace of ['google', 'vertex', 'googleVertex']) {
    const value = (providerMetadata as Record<string, unknown>)[namespace];
    if (value != null && typeof value === 'object') {
      const thoughtSignature = (value as Record<string, unknown>)
        .thoughtSignature;
      if (typeof thoughtSignature === 'string') {
        return thoughtSignature;
      }
    }
  }

  return undefined;
}

async function main() {
  const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY! });

  const result = streamText({
    model: gateway('google/gemini-3.1-flash-lite'),
    stopWhen: stepCountIs(3),
    tools: {
      get_weather: tool({
        description: 'Get the current weather for a given city.',
        inputSchema: z.object({ city: z.string() }),
        execute: async ({ city }) => ({
          city,
          tempC: city === 'Tokyo' ? 27 : 21,
          conditions: 'sunny',
        }),
      }),
    },
    prompt:
      'Use get_weather for Paris and Tokyo in parallel, then summarize both weather results.',
  });

  for await (const _ of result.textStream) {
    // drain the stream so all steps and warnings are available
  }

  const warnings = (await result.warnings) ?? [];
  const steps = await result.steps;

  const toolCalls = steps.flatMap((step, stepIndex) =>
    step.content
      .filter(part => part.type === 'tool-call')
      .map(part => ({
        stepIndex,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerMetadata: part.providerMetadata ?? null,
        hasThoughtSignature:
          readThoughtSignature(part.providerMetadata) != null,
      })),
  );

  console.log(
    JSON.stringify(
      {
        warnings,
        toolCalls,
      },
      null,
      2,
    ),
  );

  const reproduced =
    warnings.some(
      warning =>
        warning.type === 'other' &&
        warning.message.includes('skip_thought_signature_validator'),
    ) &&
    toolCalls.some(toolCall => toolCall.hasThoughtSignature) &&
    toolCalls.some(toolCall => !toolCall.hasThoughtSignature);

  if (reproduced) {
    throw new Error(
      'Issue #16298 reproduced: a valid parallel Gemini 3 tool-call batch had only one thoughtSignature, but the replay emitted the skip_thought_signature_validator warning.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
