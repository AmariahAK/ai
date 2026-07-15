import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { InvalidResponseDataError, pipeTextStreamToResponse } from 'ai';

class MockServerResponse extends EventEmitter {
  ended = false;

  write(): boolean {
    return true;
  }

  writeHead(): this {
    return this;
  }

  end(): this {
    this.ended = true;
    return this;
  }
}

async function captureUnhandledRejection(
  timeoutMs: number,
): Promise<unknown | undefined> {
  let unhandledError: unknown;
  const onUnhandledRejection = (reason: unknown) => {
    unhandledError = reason;
  };

  process.once('unhandledRejection', onUnhandledRejection);
  await delay(timeoutMs);
  process.off('unhandledRejection', onUnhandledRejection);

  return unhandledError;
}

async function main() {
  const streamError = new InvalidResponseDataError({
    data: { function: { name: null } },
    message: `Expected 'function.name' to be a string.`,
  });
  const mockResponse = new MockServerResponse();
  const response = mockResponse as unknown as ServerResponse;
  const unhandledRejection = captureUnhandledRejection(100);
  let caughtError: unknown;

  try {
    await pipeTextStreamToResponse({
      response,
      stream: new ReadableStream<string>({
        pull() {
          throw streamError;
        },
      }),
    });
  } catch (error) {
    caughtError = error;
  }

  const unhandledError = await unhandledRejection;

  console.log({
    caughtByCaller: caughtError === streamError,
    responseEnded: mockResponse.ended,
    unhandledRejection:
      unhandledError instanceof Error
        ? `${unhandledError.name}: ${unhandledError.message}`
        : unhandledError,
  });

  if (caughtError !== streamError || unhandledError !== undefined) {
    throw new Error(
      'Expected the stream error to reject pipeTextStreamToResponse so the caller could catch it, without an unhandled rejection.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
