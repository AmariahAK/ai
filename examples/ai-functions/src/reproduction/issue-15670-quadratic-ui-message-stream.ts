import { streamText, type UIMessage, type UIMessageChunk } from 'ai';
import {
  createStreamingUIMessageState,
  processUIMessageStream,
} from '../../../../packages/ai/src/ui/process-ui-message-stream';
import { MockLanguageModelV4 } from '../../../../packages/ai/src/test/mock-language-model-v4';

const chunkCount = 10_000;
const delta = 'x'.repeat(200);
const expectedMaximumMs = 1_000;

async function measureProcessUIMessageStream() {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: 'text-start', id: '1' });

      for (let index = 0; index < chunkCount; index++) {
        controller.enqueue({
          type: 'text-delta',
          id: '1',
          delta,
        });
      }

      controller.enqueue({ type: 'text-end', id: '1' });
      controller.close();
    },
  });

  const state = createStreamingUIMessageState<UIMessage>({
    lastMessage: undefined,
    messageId: 'issue-15670',
  });

  const startTime = performance.now();
  const output = processUIMessageStream({
    stream,
    runUpdateMessageJob: job =>
      job({
        state,
        write: () => {},
      }),
    onError: error => {
      throw error;
    },
  });

  const reader = output.getReader();
  while (!(await reader.read()).done) {}

  const elapsedMs = performance.now() - startTime;
  const textPart = state.message.parts.find(part => part.type === 'text');

  if (textPart?.text.length !== chunkCount * delta.length) {
    throw new Error('The stream did not accumulate the expected text.');
  }

  return elapsedMs;
}

async function measureStreamTextResult() {
  const providerStream = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'reasoning-start', id: '1' });

      for (let index = 0; index < chunkCount; index++) {
        controller.enqueue({
          type: 'reasoning-delta',
          id: '1',
          delta,
        });
      }

      controller.enqueue({ type: 'reasoning-end', id: '1' });
      controller.enqueue({
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: chunkCount,
            text: undefined,
            reasoning: chunkCount,
          },
        },
      });
      controller.close();
    },
  });

  const startTime = performance.now();
  const result = streamText({
    model: new MockLanguageModelV4({
      doStream: async () => ({ stream: providerStream }),
    }),
    prompt: 'Think for a long time.',
  });

  await result.consumeStream();
  const reasoningText = await result.reasoningText;
  const elapsedMs = performance.now() - startTime;

  if (reasoningText?.length !== chunkCount * delta.length) {
    throw new Error('The stream did not accumulate the expected reasoning.');
  }

  return elapsedMs;
}

async function main() {
  const processUIMessageStreamMs = await measureProcessUIMessageStream();
  const streamTextResultMs = await measureStreamTextResult();

  console.log(
    JSON.stringify(
      {
        chunkCount,
        chunkLength: delta.length,
        outputLength: chunkCount * delta.length,
        processUIMessageStreamMs: Math.round(processUIMessageStreamMs),
        streamTextResultMs: Math.round(streamTextResultMs),
        expectedMaximumMs,
      },
      null,
      2,
    ),
  );

  if (
    processUIMessageStreamMs > expectedMaximumMs ||
    streamTextResultMs > expectedMaximumMs
  ) {
    throw new Error(
      `Reproduced issue #15670: a long stream exceeded the expected linear-time budget of ${expectedMaximumMs}ms.`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
