import assert from 'node:assert/strict';
import { streamText, tool } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

const usage = {
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

function createToolCallModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        {
          type: 'tool-call',
          toolCallType: 'function',
          toolCallId: 'call-1',
          toolName: 'slowTool',
          input: '{}',
        },
        {
          type: 'finish',
          finishReason: { raw: undefined, unified: 'tool-calls' },
          logprobs: undefined,
          usage,
        },
      ]),
    }),
  });
}

function createRestartedModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'new stream works' },
        { type: 'text-end', id: 'text-1' },
        {
          type: 'finish',
          finishReason: { raw: undefined, unified: 'stop' },
          logprobs: undefined,
          usage,
        },
      ]),
    }),
  });
}

async function collectStream(stream: AsyncIterable<unknown>) {
  const parts: unknown[] = [];

  for await (const part of stream) {
    parts.push(part);
  }

  return parts;
}

async function main() {
  const processErrors: unknown[] = [];
  const onUncaughtException = (error: unknown) => {
    processErrors.push(error);
  };
  const onUnhandledRejection = (error: unknown) => {
    processErrors.push(error);
  };

  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    let releaseTool!: () => void;
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>(resolve => {
      markToolStarted = resolve;
    });
    const toolCanFinish = new Promise<void>(resolve => {
      releaseTool = resolve;
    });

    const abortController = new AbortController();
    const firstResult = streamText({
      model: createToolCallModel(),
      prompt: 'Run the slow tool.',
      abortSignal: abortController.signal,
      tools: {
        slowTool: tool({
          inputSchema: z.object({}),
          execute: async () => {
            markToolStarted();
            await toolCanFinish;
            return 'old stream tool result';
          },
        }),
      },
    });

    const firstStreamPromise = collectStream(firstResult.fullStream);
    await toolStarted;

    abortController.abort();

    // This is the user action from the report: start consuming a new stream
    // immediately after aborting the old one, while its tool is still pending.
    const restartedResult = streamText({
      model: createRestartedModel(),
      prompt: 'Start over.',
    });
    const restartedTextPromise = collectStream(restartedResult.textStream);

    releaseTool();

    const [firstParts, restartedText] = await Promise.all([
      firstStreamPromise,
      restartedTextPromise,
    ]);

    // Allow process-level stream errors from late microtasks to surface.
    await new Promise(resolve => setTimeout(resolve, 25));

    const invalidStateErrors = processErrors.filter(
      error =>
        error instanceof Error &&
        (error.message.includes('Controller is already closed') ||
          (error as NodeJS.ErrnoException).code === 'ERR_INVALID_STATE'),
    );

    assert.deepEqual(
      invalidStateErrors,
      [],
      `Issue #7518 reproduced: ${invalidStateErrors
        .map(error => String(error))
        .join('; ')}`,
    );
    assert.ok(
      firstParts.some(
        part =>
          typeof part === 'object' &&
          part != null &&
          'type' in part &&
          part.type === 'abort',
      ),
      'The aborted stream did not emit an abort part.',
    );
    assert.equal(restartedText.join(''), 'new stream works');

    console.log(
      JSON.stringify(
        {
          expected:
            'Aborting a stream with a pending tool and immediately starting a new stream must not enqueue into a closed controller.',
          firstStreamPartTypes: firstParts.map(part =>
            typeof part === 'object' && part != null && 'type' in part
              ? part.type
              : typeof part,
          ),
          restartedText: restartedText.join(''),
          processErrors: processErrors.map(error => String(error)),
        },
        null,
        2,
      ),
    );
  } finally {
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
