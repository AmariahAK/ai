import assert from 'node:assert/strict';
import { jsonSchema, streamText, tool } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV2 } from 'ai/test';

const ITERATIONS = 20;
const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
};

function createResolvablePromise() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createToolCallModel() {
  return new MockLanguageModelV2({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'pendingTool',
          input: '{}',
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage,
        },
      ]),
    }),
  });
}

function createReplacementModel() {
  return new MockLanguageModelV2({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'text-1' },
        {
          type: 'text-delta',
          id: 'text-1',
          delta: 'new stream works',
        },
        { type: 'text-end', id: 'text-1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage,
        },
      ]),
    }),
  });
}

async function collectText(stream: AsyncIterable<string>) {
  let text = '';
  for await (const part of stream) {
    text += part;
  }
  return text;
}

async function runIteration() {
  const abortController = new AbortController();
  const toolStarted = createResolvablePromise();

  const abortedResult = streamText({
    model: createToolCallModel(),
    prompt: 'Call the pending tool.',
    abortSignal: abortController.signal,
    tools: {
      pendingTool: tool({
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async (_input, { abortSignal }) => {
          toolStarted.resolve();

          if (!abortSignal?.aborted) {
            await new Promise<void>(resolve => {
              abortSignal?.addEventListener('abort', () => resolve(), {
                once: true,
              });
            });
          }

          return 'tool stopped';
        },
      }),
    },
  });

  const abortedPartsPromise = (async () => {
    const partTypes: string[] = [];
    for await (const part of abortedResult.fullStream) {
      partTypes.push(part.type);
    }
    return partTypes;
  })();

  await toolStarted.promise;
  abortController.abort();

  // Start the replacement synchronously after aborting the first stream.
  const replacementResult = streamText({
    model: createReplacementModel(),
    prompt: 'Start over.',
  });
  const replacementTextPromise = collectText(replacementResult.textStream);

  const [abortedPartTypes, replacementText] = await Promise.all([
    abortedPartsPromise,
    replacementTextPromise,
  ]);

  assert.ok(
    abortedPartTypes.includes('abort'),
    `aborted stream did not emit an abort part: ${abortedPartTypes.join(', ')}`,
  );
  assert.equal(replacementText, 'new stream works');
}

async function main() {
  const asynchronousErrors: unknown[] = [];
  const onUncaughtException = (error: unknown) => {
    asynchronousErrors.push(error);
  };
  const onUnhandledRejection = (error: unknown) => {
    asynchronousErrors.push(error);
  };

  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    for (let iteration = 1; iteration <= ITERATIONS; iteration++) {
      await runIteration();
      await new Promise(resolve => setTimeout(resolve, 10));

      assert.deepEqual(
        asynchronousErrors,
        [],
        `iteration ${iteration} produced an asynchronous stream error`,
      );
    }
  } finally {
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
  }

  console.log(
    `Passed ${ITERATIONS} abort-and-immediate-restart iterations without ERR_INVALID_STATE.`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
