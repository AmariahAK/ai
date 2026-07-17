import {
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
} from '../../../../packages/ai/src/index';
import { MockLanguageModelV2 } from '../../../../packages/ai/src/test/mock-language-model-v2';

const responseMetadata = {
  warnings: [],
};

async function main() {
  const abortController = new AbortController();
  let modelCallCount = 0;

  const model = new MockLanguageModelV2({
    doGenerate: async () => {
      modelCallCount++;

      if (modelCallCount === 1) {
        return {
          ...responseMetadata,
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'slowTool',
              input: '{"query":"first"}',
            },
          ],
          finishReason: 'tool-calls',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        };
      }

      return {
        ...responseMetadata,
        content: [],
        finishReason: 'other',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      };
    },
  });

  try {
    const result = await generateText({
      model,
      prompt: 'Call the slow tool three times, then summarize.',
      tools: {
        slowTool: tool({
          description: 'A tool that aborts while it is running.',
          inputSchema: jsonSchema<{ query: string }>({
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          }),
          execute: async () => {
            abortController.abort(
              new DOMException('The operation was aborted.', 'AbortError'),
            );
            abortController.signal.throwIfAborted();
            return { result: 'done' };
          },
        }),
      },
      stopWhen: stepCountIs(10),
      abortSignal: abortController.signal,
    });

    const finalStep = result.steps.at(-1);
    const firstToolError = result.steps[0]?.content.find(
      part => part.type === 'tool-error',
    );

    console.error(
      JSON.stringify({
        signalAborted: abortController.signal.aborted,
        modelCallCount,
        steps: result.steps.length,
        finishReason: result.finishReason,
        finalStepTotalTokens: finalStep?.usage.totalTokens,
        toolErrorName:
          firstToolError?.type === 'tool-error' &&
          firstToolError.error instanceof Error
            ? firstToolError.error.name
            : undefined,
      }),
    );
    throw new Error(
      'BUG REPRODUCED: generateText returned normally after abort during tool execution',
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BUG REPRODUCED:')) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      console.log('AbortError propagated as expected.');
      return;
    }

    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
