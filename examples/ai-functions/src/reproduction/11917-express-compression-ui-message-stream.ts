// @ts-nocheck
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { pipeUIMessageStreamToResponse } from 'ai';
import compression from '../../../../node_modules/.pnpm/node_modules/compression/index.js';
import express from '../../../express/node_modules/express/index.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function createDelayedUIMessageStream() {
  return new ReadableStream({
    async start(controller) {
      // The first event is available immediately. A streaming response should
      // deliver it before the later delayed events are produced.
      controller.enqueue({ type: 'text-start', id: 'text-1' });
      await delay(500);
      controller.enqueue({
        type: 'text-delta',
        id: 'text-1',
        delta: 'hello',
      });
      await delay(500);
      controller.enqueue({ type: 'text-end', id: 'text-1' });
      controller.close();
    },
  });
}

function requestAndMeasure(url: string) {
  return new Promise<{
    body: string;
    firstDecodedChunkAtMs: number | undefined;
    headers: http.IncomingHttpHeaders;
    totalMs: number;
  }>((resolve, reject) => {
    const startedAt = performance.now();
    const req = http.get(
      url,
      { headers: { 'accept-encoding': 'gzip' } },
      response => {
        const chunks: string[] = [];
        let firstDecodedChunkAtMs: number | undefined;

        const decoded =
          response.headers['content-encoding'] === 'gzip'
            ? response.pipe(createGunzip())
            : response.pipe(new PassThrough());

        decoded.setEncoding('utf8');
        decoded.on('data', chunk => {
          firstDecodedChunkAtMs ??= performance.now() - startedAt;
          chunks.push(chunk);
        });
        decoded.on('end', () => {
          resolve({
            body: chunks.join(''),
            firstDecodedChunkAtMs,
            headers: response.headers,
            totalMs: performance.now() - startedAt,
          });
        });
        decoded.on('error', reject);
      },
    );

    req.on('error', reject);
  });
}

async function main() {
  const app = express();

  // Matches the reported setup: Express with compression middleware enabled.
  // The middleware exposes res.flush(), but pipeUIMessageStreamToResponse()
  // never calls it after writing SSE chunks.
  app.use(compression());

  app.get('/stream', (_request, response) => {
    pipeUIMessageStreamToResponse({
      response,
      stream: createDelayedUIMessageStream(),
    });
  });

  const server = app.listen(0);

  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const result = await requestAndMeasure(`http://127.0.0.1:${port}/stream`);

    console.log(
      JSON.stringify(
        {
          contentEncoding: result.headers['content-encoding'],
          firstDecodedChunkAtMs: Math.round(result.firstDecodedChunkAtMs ?? -1),
          totalMs: Math.round(result.totalMs),
          bodyPreview: result.body.slice(0, 120),
        },
        null,
        2,
      ),
    );

    if (result.headers['content-encoding'] !== 'gzip') {
      throw new Error(
        'The Express compression middleware did not gzip this response, so the reported setup was not exercised.',
      );
    }

    if (result.firstDecodedChunkAtMs === undefined) {
      throw new Error('No decoded SSE data was received from the server.');
    }

    const expectedFirstChunkWithinMs = 350;
    if (result.firstDecodedChunkAtMs > expectedFirstChunkWithinMs) {
      throw new Error(
        `Issue #11917 reproduced: first SSE data was decoded after ${Math.round(
          result.firstDecodedChunkAtMs,
        )}ms instead of within ${expectedFirstChunkWithinMs}ms. Express compression buffered the AI SDK UI message stream until later chunks/end because the response was not flushed.`,
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
