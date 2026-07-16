import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { InvalidResponseDataError, pipeTextStreamToResponse } from 'ai';

const reportedMessage = `Expected 'function.name' to be a string.`;

class MockServerResponse extends EventEmitter {
  writeHead(): void {}

  write(): boolean {
    return true;
  }

  end(): void {}
}

async function main() {
  const response = new MockServerResponse() as unknown as ServerResponse;
  const streamError = new InvalidResponseDataError({
    data: { function: {} },
    message: reportedMessage,
  });
  const textStream = new ReadableStream<string>({
    start(controller) {
      controller.error(streamError);
    },
  });

  let removeUnhandledListener = () => {};
  const unhandledRejection = new Promise<unknown>(resolve => {
    const listener = (reason: unknown) => resolve(reason);
    process.once('unhandledRejection', listener);
    removeUnhandledListener = () => {
      process.off('unhandledRejection', listener);
    };
  });

  let caughtByCaller: unknown;
  try {
    await (pipeTextStreamToResponse({
      response,
      textStream,
    }) as unknown as Promise<void>);
  } catch (error) {
    caughtByCaller = error;
  }

  if (caughtByCaller !== undefined) {
    removeUnhandledListener();
    console.log(
      'PASS: the caller caught the stream error from pipeTextStreamToResponse.',
    );
    return;
  }

  const outcome = await Promise.race([
    unhandledRejection.then(reason => ({ type: 'unhandled', reason }) as const),
    new Promise<{ type: 'timeout' }>(resolve => {
      setTimeout(() => resolve({ type: 'timeout' }), 250);
    }),
  ]);

  removeUnhandledListener();

  if (outcome.type === 'timeout') {
    throw new Error(
      'No catchable error or unhandled rejection was observed from the failing stream.',
    );
  }

  const reason = outcome.reason;
  const isReportedError =
    InvalidResponseDataError.isInstance(reason) &&
    reason.message === reportedMessage;

  if (!isReportedError) {
    throw new Error(`Unexpected unhandled rejection: ${String(reason)}`);
  }

  console.error(
    'REPRODUCED: pipeTextStreamToResponse returned before the stream failed; the caller catch was bypassed and AI_InvalidResponseDataError became an unhandled rejection.',
  );
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
