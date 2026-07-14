import assert from 'node:assert/strict';
import { streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

async function main() {
  const abortController = new AbortController();
  const callbacks: Array<{
    name: 'onAbort' | 'onError';
    errorName?: string;
    steps?: number;
  }> = [];

  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      await new Promise<never>((_, reject) => {
        if (abortSignal == null) {
          reject(new Error('Expected streamText to forward the abort signal'));
          return;
        }

        if (abortSignal.aborted) {
          reject(abortSignal.reason);
          return;
        }

        abortSignal.addEventListener(
          'abort',
          () => reject(abortSignal.reason),
          { once: true },
        );
      });

      throw new Error('unreachable');
    },
  });

  setTimeout(() => abortController.abort(), 100);

  const { textStream } = streamText({
    model,
    prompt: 'Start a response that will be cancelled immediately.',
    abortSignal: abortController.signal,
    onError: ({ error }) => {
      callbacks.push({
        name: 'onError',
        errorName: error instanceof Error ? error.name : typeof error,
      });
    },
    onAbort: ({ steps }) => {
      callbacks.push({ name: 'onAbort', steps: steps.length });
    },
  });

  for await (const _ of textStream) {
    // The model call is aborted before a provider stream is returned.
  }

  console.log(JSON.stringify(callbacks, null, 2));

  assert.deepEqual(
    callbacks,
    [{ name: 'onAbort', steps: 0 }],
    'A short AbortSignal cancellation must call onAbort, not onError.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
