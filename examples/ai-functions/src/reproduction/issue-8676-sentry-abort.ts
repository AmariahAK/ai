import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { streamText as streamTextV5 } from 'ai-v5-0-44';

const require = createRequire(import.meta.url);

type AiV5Module = {
  streamText: typeof streamTextV5;
};

type SentryVercelAiInstrumentation = {
  _patch(moduleExports: unknown): AiV5Module;
};

async function main() {
  const aiV5 = require('ai-v5-0-44') as AiV5Module;

  // Load the exact Vercel AI instrumentation implementation shipped by
  // @sentry/node@10.12.0, the version from the linked Sentry report.
  const sentryEntry = require.resolve('sentry-node-v10-12-0');
  const instrumentationPath = path.join(
    path.dirname(sentryEntry),
    'integrations/tracing/vercelai/instrumentation.js',
  );
  const { SentryVercelAiInstrumentation } = require(instrumentationPath) as {
    SentryVercelAiInstrumentation: new () => SentryVercelAiInstrumentation;
  };

  // Calling _patch directly avoids relying on a process-level ESM/CJS loader
  // hook while exercising the integration's exact streamText wrapper.
  const instrumentedAi = new SentryVercelAiInstrumentation()._patch(aiV5);
  const runAbortScenario = async (
    streamText: typeof aiV5.streamText,
  ): Promise<unknown[]> => {
    const abortController = new AbortController();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const result = streamText({
        model: {
          specificationVersion: 'v2',
          provider: 'reproduction',
          modelId: 'abort-before-output',
          supportedUrls: {},
          doGenerate: async () => {
            throw new Error('doGenerate is not used by this reproduction');
          },
          doStream: async ({ abortSignal }) => ({
            stream: new ReadableStream({
              start(controller) {
                queueMicrotask(() => {
                  abortController.abort();
                  assert.equal(abortSignal?.aborted, true);
                  controller.error(
                    new DOMException(
                      'The user aborted a request.',
                      'AbortError',
                    ),
                  );
                });
              },
            }),
          }),
        },
        prompt: 'Reproduce issue #8676',
        abortSignal: abortController.signal,
      });

      await result.consumeStream();

      // Let Node emit unhandledRejection for any promise left without a
      // rejection handler during stream finalization.
      await new Promise(resolve => setTimeout(resolve, 0));

      return unhandledRejections;
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  };

  const baselineRejections = await runAbortScenario(aiV5.streamText);
  assert.deepEqual(
    baselineRejections,
    [],
    'The same abort unexpectedly failed without Sentry instrumentation.',
  );

  const instrumentedRejections = await runAbortScenario(
    instrumentedAi.streamText,
  );
  assert.deepEqual(
    instrumentedRejections,
    [],
    `A normal abort must not create unhandled result promise rejections. Observed: ${instrumentedRejections
      .map(
        error =>
          `${(error as Error)?.name ?? typeof error}: ${
            (error as Error)?.message ?? String(error)
          }`,
      )
      .join(', ')}`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
