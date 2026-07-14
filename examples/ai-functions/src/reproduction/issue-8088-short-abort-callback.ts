import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import assert from 'node:assert/strict';
import { APICallError, type ModelMessage, streamText } from 'ai';

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

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(APICallError.isInstance(error)
        ? { statusCode: error.statusCode }
        : {}),
    };
  }

  return { value: String(error) };
}

async function main() {
  let fetchResponseStatus: number | undefined;
  let fetchError: unknown;
  const openai = createOpenAI({
    fetch: async (input, init) => {
      try {
        const response = await globalThis.fetch(input, init);
        fetchResponseStatus = response.status;
        return response;
      } catch (error) {
        fetchError = error;
        throw error;
      }
    },
  });
  const abortController = new AbortController();
  const callbackErrors: unknown[] = [];
  let onAbortCalls = 0;
  let onFinishCalls = 0;
  let streamedText = '';
  let streamError: unknown;

  const abortTimer = setTimeout(() => abortController.abort(), 100);
  const startedAt = performance.now();

  const result = streamText({
    model: openai.responses('gpt-5-nano'),
    messages,
    abortSignal: abortController.signal,
    onFinish: () => {
      onFinishCalls++;
    },
    onError: ({ error }) => {
      callbackErrors.push(error);
    },
    onAbort: () => {
      onAbortCalls++;
    },
  });

  try {
    for await (const delta of result.textStream) {
      streamedText += delta;
    }
  } catch (error) {
    streamError = error;
  } finally {
    clearTimeout(abortTimer);
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  const observation = {
    model: 'gpt-5-nano',
    abortDelayMs: 100,
    elapsedMs,
    signalAborted: abortController.signal.aborted,
    onAbortCalls,
    onErrorCalls: callbackErrors.length,
    onFinishCalls,
    streamedTextLength: streamedText.length,
    fetchResponseStatus,
    fetchError:
      fetchError === undefined ? undefined : summarizeError(fetchError),
    callbackErrors: callbackErrors.map(summarizeError),
    streamError:
      streamError === undefined ? undefined : summarizeError(streamError),
  };

  console.log(JSON.stringify(observation, null, 2));

  const accessError = [...callbackErrors, streamError].find(
    error =>
      APICallError.isInstance(error) &&
      error.statusCode != null &&
      [401, 402, 403, 429].includes(error.statusCode),
  );

  if (accessError != null) {
    throw new Error(
      `Live OpenAI request was blocked: ${JSON.stringify(
        summarizeError(accessError),
      )}`,
    );
  }

  assert.equal(
    abortController.signal.aborted,
    true,
    'the 100 ms abort must occur before evaluating callback routing',
  );
  assert.equal(
    onAbortCalls,
    1,
    'expected the short abort to invoke onAbort exactly once',
  );
  assert.equal(
    callbackErrors.length,
    0,
    'issue #8088 reproduced: the short abort invoked onError',
  );
  assert.equal(onFinishCalls, 0, 'an aborted stream must not invoke onFinish');
  assert.equal(
    streamError,
    undefined,
    'the aborted text stream should close without throwing',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
