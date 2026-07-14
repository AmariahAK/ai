import assert from 'node:assert/strict';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import {
  createStreamingUIMessageState,
  processUIMessageStream,
} from '../../../../packages/ai/src/ui/process-ui-message-stream';
import type { UIMessage } from '../../../../packages/ai/src/ui/ui-messages';

const CHUNK = 'x'.repeat(200);
const REPORTED_CHUNK_COUNT = 10_000;
const EXPECTED_MAX_MS = 1_000;

async function consume(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();

  while (!(await reader.read()).done) {
    // Consume every output chunk.
  }
}

async function benchmarkUIMessageStream({
  chunkCount,
  flattenBetweenDeltas,
}: {
  chunkCount: number;
  flattenBetweenDeltas: boolean;
}) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'text-start', id: '1' });

      for (let i = 0; i < chunkCount; i++) {
        controller.enqueue({
          type: 'text-delta',
          id: '1',
          delta: CHUNK,
        });
      }

      controller.enqueue({ type: 'text-end', id: '1' });
      controller.close();
    },
  });

  const state = createStreamingUIMessageState<UIMessage>({
    lastMessage: undefined,
    messageId: 'm1',
  });
  let sink = 0;

  const start = performance.now();

  await consume(
    processUIMessageStream({
      stream,
      runUpdateMessageJob: job =>
        job({
          state,
          write: () => {
            if (!flattenBetweenDeltas) {
              return;
            }

            const textPart = state.message.parts.find(
              part => part.type === 'text',
            );

            if (textPart != null && textPart.text.length > 0) {
              // A progressive UI render or serializer reads the cumulative
              // string between writes. charCodeAt is a constant-size read that
              // forces V8 to flatten the concatenation rope.
              sink ^= textPart.text.charCodeAt(textPart.text.length - 1);
            }
          },
        }),
      onError: error => {
        throw error;
      },
    }),
  );

  const elapsedMs = performance.now() - start;
  const textPart = state.message.parts.find(part => part.type === 'text');

  assert.equal(textPart?.text.length, chunkCount * CHUNK.length);

  return { elapsedMs, sink };
}

function createProviderStream({
  chunkCount,
  kind,
}: {
  chunkCount: number;
  kind: 'text' | 'reasoning';
}) {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      controller.enqueue({ type: `${kind}-start`, id: '1' });

      for (let i = 0; i < chunkCount; i++) {
        controller.enqueue({
          type: `${kind}-delta`,
          id: '1',
          delta: CHUNK,
        });
      }

      controller.enqueue({ type: `${kind}-end`, id: '1' });
      controller.enqueue({
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: {
            total: chunkCount,
            text: kind === 'text' ? chunkCount : 0,
            reasoning: kind === 'reasoning' ? chunkCount : 0,
          },
        },
      });
      controller.close();
    },
  });
}

async function benchmarkDefaultStreamTextResult(kind: 'text' | 'reasoning') {
  const result = streamText({
    model: new MockLanguageModelV3({
      doStream: async () => ({
        stream: createProviderStream({
          chunkCount: REPORTED_CHUNK_COUNT,
          kind,
        }),
      }),
    }),
    prompt: 'Reproduce issue #15670',
  });

  const start = performance.now();
  const output =
    kind === 'text' ? await result.text : await result.reasoningText;
  const elapsedMs = performance.now() - start;

  assert.equal(output?.length, REPORTED_CHUNK_COUNT * CHUNK.length);

  return elapsedMs;
}

async function main() {
  await benchmarkUIMessageStream({
    chunkCount: 100,
    flattenBetweenDeltas: true,
  });

  const exactReportedShape = await benchmarkUIMessageStream({
    chunkCount: REPORTED_CHUNK_COUNT,
    flattenBetweenDeltas: false,
  });
  const progressiveReadHalf = await benchmarkUIMessageStream({
    chunkCount: REPORTED_CHUNK_COUNT / 2,
    flattenBetweenDeltas: true,
  });
  const progressiveReadFull = await benchmarkUIMessageStream({
    chunkCount: REPORTED_CHUNK_COUNT,
    flattenBetweenDeltas: true,
  });
  const defaultTextMs = await benchmarkDefaultStreamTextResult('text');
  const defaultReasoningMs =
    await benchmarkDefaultStreamTextResult('reasoning');

  const result = {
    runtime: process.version,
    chunkSize: CHUNK.length,
    exactReportedShapeMs: Number(exactReportedShape.elapsedMs.toFixed(1)),
    progressiveRead5000Ms: Number(progressiveReadHalf.elapsedMs.toFixed(1)),
    progressiveRead10000Ms: Number(progressiveReadFull.elapsedMs.toFixed(1)),
    progressiveReadScalingRatio: Number(
      (progressiveReadFull.elapsedMs / progressiveReadHalf.elapsedMs).toFixed(
        2,
      ),
    ),
    defaultStreamTextResultTextMs: Number(defaultTextMs.toFixed(1)),
    defaultStreamTextResultReasoningMs: Number(defaultReasoningMs.toFixed(1)),
    expectedProgressiveReadMaxMs: EXPECTED_MAX_MS,
  };

  console.log(JSON.stringify(result, null, 2));

  assert.ok(
    progressiveReadFull.elapsedMs <= EXPECTED_MAX_MS,
    `processUIMessageStream took ${progressiveReadFull.elapsedMs.toFixed(1)} ms ` +
      `for the reported 2,000,000-character stream after progressive reads; ` +
      `expected at most ${EXPECTED_MAX_MS} ms.`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
