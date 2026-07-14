import assert from 'node:assert/strict';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { streamText, tool } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

const testUsage = {
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
};

function createResolvablePromise() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function runIteration(iteration: number) {
  const abortController = new AbortController();
  const toolStarted = createResolvablePromise();

  const abortedResult = streamText({
    model: new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({
              type: 'tool-call',
              toolCallId: `call-${iteration}`,
              toolName: 'delayedTool',
              input: '{}',
            });

            abortSignal?.addEventListener(
              'abort',
              () => controller.error(abortSignal.reason),
              { once: true },
            );
          },
        }),
      }),
    }),
    abortSignal: abortController.signal,
    prompt: 'Call the delayed tool.',
    tools: {
      delayedTool: tool({
        inputSchema: z.object({}),
        execute: async () => {
          toolStarted.resolve();
          await new Promise(resolve => setTimeout(resolve, 25));
          return 'late tool result';
        },
      }),
    },
  });

  const abortedPartsPromise = (async () => {
    const parts = [];
    for await (const part of abortedResult.fullStream) {
      parts.push(part);
    }
    return parts;
  })();

  await toolStarted.promise;
  abortController.abort();

  // Start the replacement synchronously after aborting the previous stream.
  const replacementResult = streamText({
    model: new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
          { type: 'text-start', id: `text-${iteration}` },
          {
            type: 'text-delta',
            id: `text-${iteration}`,
            delta: 'new stream works',
          },
          { type: 'text-end', id: `text-${iteration}` },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: testUsage,
          },
        ]),
      }),
    }),
    prompt: 'Return a successful replacement response.',
  });

  const [abortedParts, replacementText] = await Promise.all([
    abortedPartsPromise,
    replacementResult.text,
  ]);

  assert.equal(replacementText, 'new stream works');
  assert.ok(
    abortedParts.some(part => part.type === 'abort'),
    'the aborted stream did not emit an abort part',
  );

  // Let the ignored tool finish after its stream has already been aborted.
  await new Promise(resolve => setTimeout(resolve, 35));
}

async function main() {
  const asynchronousErrors: unknown[] = [];
  const recordAsynchronousError = (error: unknown) => {
    asynchronousErrors.push(error);
  };

  process.on('uncaughtException', recordAsynchronousError);
  process.on('unhandledRejection', recordAsynchronousError);

  try {
    for (let iteration = 1; iteration <= 20; iteration++) {
      await runIteration(iteration);
    }

    assert.deepEqual(
      asynchronousErrors,
      [],
      `unexpected asynchronous errors: ${asynchronousErrors
        .map(error => String(error))
        .join(', ')}`,
    );

    console.log(
      'Passed 20 iterations: each aborted stream emitted an abort part, each replacement returned "new stream works", and no ERR_INVALID_STATE occurred.',
    );
  } finally {
    process.off('uncaughtException', recordAsynchronousError);
    process.off('unhandledRejection', recordAsynchronousError);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
