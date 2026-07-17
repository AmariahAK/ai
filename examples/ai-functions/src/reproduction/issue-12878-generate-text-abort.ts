import { generateText, isStepCount, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

const reproducedSignal =
  'ISSUE_REPRODUCED: generateText returned normally after aborting a multi-step tool loop';

const zeroUsage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 0,
    text: 0,
    reasoning: undefined,
  },
};

async function main() {
  const abortController = new AbortController();
  let modelCallCount = 0;

  const model = new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      modelCallCount++;

      if (modelCallCount === 1) {
        return {
          content: [
            {
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: 'slow-tool-call',
              toolName: 'slowTool',
              input: JSON.stringify({ query: 'first query' }),
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
          usage: zeroUsage,
          warnings: [],
        };
      }

      if (!abortSignal?.aborted) {
        throw new Error(
          'Reproduction setup failed: second call was not aborted',
        );
      }

      // Model the partial response reported for an HTTP call made with an
      // already-aborted signal.
      return {
        content: [],
        finishReason: { unified: 'other', raw: 'unknown' },
        usage: zeroUsage,
        warnings: [],
      };
    },
  });

  const slowTool = tool({
    description: 'A tool that waits until the operation is aborted',
    inputSchema: z.object({ query: z.string() }),
    execute: async (_input, { abortSignal }) => {
      setTimeout(() => abortController.abort(), 10);

      await new Promise<never>((_resolve, reject) => {
        abortSignal?.addEventListener(
          'abort',
          () => reject(abortSignal.reason),
          { once: true },
        );
      });
    },
  });

  try {
    const result = await generateText({
      model,
      prompt: 'Call the slow tool, then summarize.',
      tools: { slowTool },
      stopWhen: isStepCount(10),
      abortSignal: abortController.signal,
      maxRetries: 0,
    });

    console.error(
      JSON.stringify({
        finishReason: result.finishReason,
        steps: result.steps.length,
        lastStepUsage: result.steps.at(-1)?.usage,
        signalAborted: abortController.signal.aborted,
        modelCallCount,
      }),
    );
    throw new Error(reproducedSignal);
  } catch (error) {
    if (error instanceof Error && error.message === reproducedSignal) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('Expected behavior: generateText propagated AbortError');
      return;
    }

    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
