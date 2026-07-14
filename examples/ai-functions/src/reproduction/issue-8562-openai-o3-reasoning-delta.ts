import {
  openai,
  type OpenAILanguageModelResponsesOptions,
} from '@ai-sdk/openai';
import { streamText } from 'ai';

const attempts = Number.parseInt(process.env.REPRO_ATTEMPTS ?? '5', 10);

async function runAttempt(attempt: number) {
  const result = streamText({
    model: openai('o3'),
    prompt: 'Suggest 10 outside activites for a rainy day.',
    providerOptions: {
      openai: {
        reasoningEffort: 'medium',
        reasoningSummary: 'auto',
      } satisfies OpenAILanguageModelResponsesOptions,
    },
    include: {
      rawChunks: true,
    },
  });

  const rawEventTypeCounts: Record<string, number> = {};
  let reasoningDeltaCount = 0;
  let reasoningText = '';
  let text = '';

  for await (const part of result.fullStream) {
    if (part.type === 'raw') {
      const rawValue = part.rawValue;
      if (
        typeof rawValue === 'object' &&
        rawValue !== null &&
        'type' in rawValue &&
        typeof rawValue.type === 'string'
      ) {
        rawEventTypeCounts[rawValue.type] =
          (rawEventTypeCounts[rawValue.type] ?? 0) + 1;
      }
    } else if (part.type === 'reasoning-delta') {
      reasoningDeltaCount++;
      reasoningText += part.text;
    } else if (part.type === 'text-delta') {
      text += part.text;
    } else if (part.type === 'error') {
      throw part.error;
    }
  }

  const providerReasoningDeltaCount =
    rawEventTypeCounts['response.reasoning_summary_text.delta'] ?? 0;

  const observation = {
    attempt,
    reasoningDeltaCount,
    reasoningLength: reasoningText.length,
    providerReasoningDeltaCount,
    textLength: text.length,
    rawEventTypeCounts,
  };

  console.log(JSON.stringify(observation, null, 2));

  return observation;
}

async function main() {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('REPRO_ATTEMPTS must be a positive integer.');
  }

  const observations = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    observations.push(await runAttempt(attempt));
  }

  const missingReasoning = observations.filter(
    observation =>
      observation.reasoningDeltaCount === 0 ||
      observation.reasoningLength === 0,
  );

  if (missingReasoning.length > 0) {
    throw new Error(
      `Issue #8562 reproduced: ${missingReasoning.length}/${attempts} successful o3 streams contained no non-empty reasoning-delta parts.`,
    );
  }

  console.log(
    `Issue #8562 was not observed: all ${attempts} o3 streams contained non-empty reasoning-delta parts.`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
