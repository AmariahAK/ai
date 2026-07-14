import assert from 'node:assert/strict';
import { generateText, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

async function main() {
  const callbacks: string[] = [];

  await generateText({
    model: new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'demo',
            input: '{"value":"ready"}',
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 1,
            text: 1,
            reasoning: undefined,
          },
        },
        warnings: [],
      },
    }),
    prompt: 'Call the demo tool.',
    tools: {
      demo: tool({
        inputSchema: z.object({ value: z.string() }),
        onInputStart: () => {
          callbacks.push('onInputStart');
        },
        onInputAvailable: () => {
          callbacks.push('onInputAvailable');
        },
      }),
    },
  });

  console.log('Observed callbacks:', callbacks);

  assert.deepEqual(
    callbacks,
    ['onInputStart', 'onInputAvailable'],
    '`onInputStart` should be called before `onInputAvailable`.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
