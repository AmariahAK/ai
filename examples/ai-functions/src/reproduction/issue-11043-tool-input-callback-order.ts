import { generateText, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

async function main() {
  const callbacks: string[] = [];

  await generateText({
    model: new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call',
            toolCallType: 'function',
            toolCallId: 'call-1',
            toolName: 'testTool',
            input: '{"value":"ready"}',
          },
        ],
        finishReason: { raw: 'tool-calls', unified: 'tool-calls' },
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
      }),
    }),
    prompt: 'Call the test tool.',
    tools: {
      testTool: tool({
        inputSchema: z.object({ value: z.string() }),
        onInputStart: () => {
          callbacks.push('onInputStart');
        },
        onInputAvailable: () => {
          callbacks.push('onInputAvailable');
        },
      }),
    },
    toolChoice: 'required',
  });

  const expected = ['onInputStart', 'onInputAvailable'];

  if (JSON.stringify(callbacks) !== JSON.stringify(expected)) {
    throw new Error(
      `ISSUE_11043_REPRODUCED: expected ${expected.join(' -> ')}, observed ${callbacks.join(' -> ') || '(no callbacks)'}`,
    );
  }

  console.log(`Callback order: ${callbacks.join(' -> ')}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
