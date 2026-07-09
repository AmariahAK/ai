import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import compression from 'compression';
import express, { type Request, type Response } from 'express';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessageChunk,
} from 'ai';

const chunkDelayMs = 200;
const chunkCount = 5;
const maxExpectedFirstChunkMs = 500;

function createDelayedUIMessageStream(): ReadableStream<UIMessageChunk> {
  return createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: 'start', messageId: 'message-1' });
      writer.write({ type: 'text-start', id: 'text-1' });

      for (let index = 1; index <= chunkCount; index++) {
        await delay(chunkDelayMs);
        writer.write({
          type: 'text-delta',
          id: 'text-1',
          delta: `chunk-${index} `,
        });
      }

      writer.write({ type: 'text-end', id: 'text-1' });
      writer.write({ type: 'finish', finishReason: 'stop' });
    },
  });
}

function pipeDelayedStream(_request: Request, response: Response) {
  pipeUIMessageStreamToResponse({
    response,
    stream: createDelayedUIMessageStream(),
  });
}

function listen(server: Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function readUIMessageStream(url: string) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'accept-encoding': 'gzip',
    },
  });

  assert.equal(response.status, 200);
  assert.ok(response.body, 'Expected a response body');

  const chunks: Array<{ elapsedMs: number; text: string }> = [];
  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push({
      elapsedMs: Math.round(performance.now() - startedAt),
      text: decoder.decode(value, { stream: true }),
    });
  }

  const finalText = decoder.decode();
  if (finalText.length > 0) {
    chunks.push({
      elapsedMs: Math.round(performance.now() - startedAt),
      text: finalText,
    });
  }

  return {
    cacheControl: response.headers.get('cache-control'),
    contentEncoding: response.headers.get('content-encoding'),
    chunks,
    totalMs: Math.round(performance.now() - startedAt),
  };
}

async function main() {
  const app = express();

  // Control route: the same UI message stream without the compression middleware.
  app.post('/plain', pipeDelayedStream);

  // Reported setup: Express with compression middleware before the AI SDK
  // UI message stream route.
  app.use(compression({ threshold: 0 }));
  app.post('/compressed', pipeDelayedStream);

  const server = createServer(app);

  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    const plain = await readUIMessageStream(`${baseUrl}/plain`);
    const compressed = await readUIMessageStream(`${baseUrl}/compressed`);

    const plainFirstChunkMs = plain.chunks[0]?.elapsedMs ?? Infinity;
    const compressedFirstChunkMs = compressed.chunks[0]?.elapsedMs ?? Infinity;

    console.log(
      JSON.stringify(
        {
          plain: {
            cacheControl: plain.cacheControl,
            contentEncoding: plain.contentEncoding,
            firstChunkMs: plainFirstChunkMs,
            chunkCount: plain.chunks.length,
            totalMs: plain.totalMs,
          },
          compressed: {
            cacheControl: compressed.cacheControl,
            contentEncoding: compressed.contentEncoding,
            firstChunkMs: compressedFirstChunkMs,
            chunkCount: compressed.chunks.length,
            totalMs: compressed.totalMs,
          },
        },
        null,
        2,
      ),
    );

    assert.ok(
      plainFirstChunkMs < maxExpectedFirstChunkMs,
      `Control route should stream the first chunk within ${maxExpectedFirstChunkMs}ms, but it arrived after ${plainFirstChunkMs}ms.`,
    );

    assert.equal(
      compressed.contentEncoding,
      'gzip',
      'The compressed route should be handled by Express compression middleware.',
    );

    assert.ok(
      compressedFirstChunkMs < maxExpectedFirstChunkMs,
      [
        `Expected Express + compression to stream the first UI message chunk within ${maxExpectedFirstChunkMs}ms.`,
        `Instead the first readable chunk arrived after ${compressedFirstChunkMs}ms, after the delayed stream had effectively completed.`,
      ].join(' '),
    );
  } finally {
    await close(server);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
