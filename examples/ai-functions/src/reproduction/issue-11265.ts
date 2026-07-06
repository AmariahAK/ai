import { APICallError } from '@ai-sdk/provider';
import { postToApi, retryWithExponentialBackoff } from '@ai-sdk/provider-utils';
import { createServer } from 'node:http';

async function main() {
  let requestCount = 0;

  const server = createServer((_, response) => {
    requestCount++;

    if (requestCount === 1) {
      response.writeHead(200, {
        'content-type': 'application/json',
        // Larger than the bytes written below so the client must keep reading
        // the successful 200 response body until the socket is closed.
        'content-length': '1024',
      });
      response.flushHeaders();
      response.write('{"ok":');

      setTimeout(() => {
        response.socket?.destroy();
      }, 50);
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, requestCount }));
  });

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('Expected server to listen on a local TCP port.');
  }

  const url = `http://127.0.0.1:${address.port}/body-read-reset`;

  const retry = retryWithExponentialBackoff({
    maxRetries: 1,
    initialDelayInMs: 0,
    backoffFactor: 1,
    shouldRetry: error =>
      error instanceof Error &&
      APICallError.isInstance(error) &&
      error.isRetryable === true,
  });

  try {
    const result = await retry(() =>
      postToApi({
        url,
        body: {
          content: JSON.stringify({ prompt: 'hello' }),
          values: { prompt: 'hello' },
        },
        failedResponseHandler: async ({ response, url, requestBodyValues }) => ({
          value: new APICallError({
            message: 'unexpected non-2xx response',
            statusCode: response.status,
            url,
            requestBodyValues,
          }),
        }),
        successfulResponseHandler: async ({ response }) => ({
          value: JSON.parse(await response.text()) as unknown,
        }),
      }),
    );

    if (requestCount !== 2) {
      throw new Error(
        `Expected the transient body-read network error to be retried once, but the server saw ${requestCount} request(s).`,
      );
    }

    console.log('Request was retried and succeeded:', result);
  } catch (error) {
    if (APICallError.isInstance(error)) {
      console.error(
        JSON.stringify(
          {
            message: error.message,
            statusCode: error.statusCode,
            isRetryable: error.isRetryable,
            requestCount,
            cause:
              error.cause instanceof Error
                ? {
                    name: error.cause.name,
                    message: error.cause.message,
                    cause: (error.cause as { cause?: unknown }).cause,
                  }
                : error.cause,
          },
          null,
          2,
        ),
      );
    }

    throw error;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
