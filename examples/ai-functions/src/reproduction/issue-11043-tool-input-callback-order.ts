import type { LanguageModelV4 } from '@ai-sdk/provider';
import { generateText, tool } from 'ai';
import { z } from 'zod';

const toolCallId = 'call-1';
const callbackSequence: string[] = [];

const model: LanguageModelV4 = {
  specificationVersion: 'v4',
  provider: 'issue-11043-reproduction',
  modelId: 'complete-tool-call',
  supportedUrls: {},
  async doGenerate() {
    return {
      content: [
        {
          type: 'tool-call' as const,
          toolCallType: 'function' as const,
          toolCallId,
          toolName: 'weather',
          input: '{"location":"San Francisco"}',
        },
      ],
      finishReason: { unified: 'tool-calls' as const, raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: {
          total: 1,
          text: 0,
          reasoning: 0,
        },
      },
      warnings: [],
    };
  },
  async doStream() {
    throw new Error('This reproduction only uses non-streaming generation.');
  },
};

async function main() {
  await generateText({
    model,
    prompt: 'What is the weather in San Francisco?',
    tools: {
      weather: tool({
        inputSchema: z.object({ location: z.string() }),
        onInputStart() {
          callbackSequence.push('onInputStart');
        },
        onInputAvailable() {
          callbackSequence.push('onInputAvailable');
        },
      }),
    },
  });

  const expectedSequence = ['onInputStart', 'onInputAvailable'];
  if (callbackSequence.join(',') !== expectedSequence.join(',')) {
    throw new Error(
      `ISSUE_11043_REPRODUCED: onInputAvailable was called without prior onInputStart; sequence=${callbackSequence.join(',')}`,
    );
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
