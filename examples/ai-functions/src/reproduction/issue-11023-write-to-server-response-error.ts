import type { ServerResponse } from 'node:http';
import { InvalidResponseDataError, pipeTextStreamToResponse } from 'ai';

const errorMessage = "Expected 'function.name' to be a string.";
const failureSignal =
  "ISSUE #11023 REPRODUCED: pipeTextStreamToResponse returned before the stream failed, so the caller's catch was bypassed and AI_InvalidResponseDataError became an unhandled rejection.";

function createResponse(): ServerResponse {
  return {
    writeHead() {
      return this;
    },
    write() {
      return true;
    },
    end() {
      return this;
    },
  } as unknown as ServerResponse;
}

function formatError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

async function main() {
  let resolveUnhandled: (reason: unknown) => void;
  const unhandledPromise = new Promise<unknown>(resolve => {
    resolveUnhandled = resolve;
  });
  const onUnhandledRejection = (reason: unknown) => resolveUnhandled(reason);

  process.once('unhandledRejection', onUnhandledRejection);

  let caughtByCaller: unknown;

  try {
    await pipeTextStreamToResponse({
      response: createResponse(),
      textStream: new ReadableStream<string>({
        start(controller) {
          queueMicrotask(() => {
            controller.error(
              new InvalidResponseDataError({
                data: { function: {} },
                message: errorMessage,
              }),
            );
          });
        },
      }),
    });
  } catch (error) {
    caughtByCaller = error;
  }

  const outcome = await Promise.race([
    unhandledPromise.then(reason => ({ type: 'unhandled' as const, reason })),
    new Promise<{ type: 'timeout' }>(resolve =>
      setTimeout(() => resolve({ type: 'timeout' }), 1000),
    ),
  ]);

  process.removeListener('unhandledRejection', onUnhandledRejection);

  if (caughtByCaller !== undefined) {
    console.log(
      `Caller caught the stream error: ${formatError(caughtByCaller)}`,
    );
    return;
  }

  if (
    outcome.type === 'unhandled' &&
    InvalidResponseDataError.isInstance(outcome.reason) &&
    outcome.reason.message === errorMessage
  ) {
    console.error(failureSignal);
    console.error(`Unhandled rejection: ${formatError(outcome.reason)}`);
    process.exitCode = 1;
    return;
  }

  throw new Error(
    outcome.type === 'unhandled'
      ? `Unexpected unhandled rejection: ${formatError(outcome.reason)}`
      : 'The stream error was neither caught by the caller nor emitted as an unhandled rejection.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
