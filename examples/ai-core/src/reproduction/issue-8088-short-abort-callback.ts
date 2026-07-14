import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type ModelMessage } from 'ai';
import assert from 'node:assert/strict';

type FetchOutcome =
  | { type: 'pending' }
  | { type: 'response'; status: number }
  | { type: 'rejection'; errorName: string; errorMessage: string };

function getErrorDetails(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: typeof error, message: String(error) };
}

async function main() {
  let fetchOutcome: FetchOutcome = { type: 'pending' };
  const getFetchOutcome = (): FetchOutcome => fetchOutcome;

  const openai = createOpenAI({
    fetch: async (input, init) => {
      try {
        const response = await fetch(input, init);
        fetchOutcome = { type: 'response', status: response.status };
        return response;
      } catch (error) {
        const details = getErrorDetails(error);
        fetchOutcome = {
          type: 'rejection',
          errorName: details.name,
          errorMessage: details.message,
        };
        throw error;
      }
    },
  });

  const messages: ModelMessage[] = [
    {
      role: 'system',
      content:
        'You are a helpful assistant that can answer questions and help with tasks.',
    },
    {
      role: 'user',
      content: 'What is the current price of Bitcoin?',
    },
  ];

  const abortController = new AbortController();
  const callbackCounts = {
    onAbort: 0,
    onError: 0,
    onFinish: 0,
  };
  const callbackErrors: Array<{ name: string; message: string }> = [];
  let iteratorError: { name: string; message: string } | undefined;

  const abortTimer = setTimeout(() => abortController.abort(), 100);
  const startedAt = performance.now();

  const { textStream } = streamText({
    model: openai.responses('gpt-5-nano'),
    messages,
    abortSignal: abortController.signal,
    maxRetries: 0,
    onAbort: () => {
      callbackCounts.onAbort++;
    },
    onError: ({ error }) => {
      callbackCounts.onError++;
      callbackErrors.push(getErrorDetails(error));
    },
    onFinish: () => {
      callbackCounts.onFinish++;
    },
  });

  try {
    for await (const _textDelta of textStream) {
      // Consuming the stream is required for callback dispatch.
    }
  } catch (error) {
    iteratorError = getErrorDetails(error);
  } finally {
    clearTimeout(abortTimer);
  }

  const finalFetchOutcome = getFetchOutcome();
  const observation = {
    sdkVersions: {
      ai: (await import('ai/package.json')).version,
      openai: (await import('@ai-sdk/openai/package.json')).version,
    },
    abortDelayMs: 100,
    elapsedMs: Math.round(performance.now() - startedAt),
    signalAborted: abortController.signal.aborted,
    fetchOutcome: finalFetchOutcome,
    callbackCounts,
    callbackErrors,
    iteratorError,
  };

  console.log(JSON.stringify(observation, null, 2));

  if (
    finalFetchOutcome.type === 'response' &&
    [401, 402, 403, 429].includes(finalFetchOutcome.status)
  ) {
    throw new Error(
      `Provider access blocker: HTTP ${finalFetchOutcome.status}`,
    );
  }

  assert.equal(
    callbackCounts.onAbort,
    1,
    'Expected a 100 ms AbortSignal to invoke onAbort exactly once.',
  );
  assert.equal(
    callbackCounts.onError,
    0,
    'Issue #8088 reproduced: the short abort invoked onError.',
  );
  assert.equal(
    callbackCounts.onFinish,
    0,
    'An aborted stream must not invoke onFinish.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
