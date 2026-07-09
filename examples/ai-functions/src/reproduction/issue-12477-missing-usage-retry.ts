import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { once } from 'node:events';

const modelId = 'kimi-k2.5-free';

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
  }

  return body;
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  headers: Record<string, string>,
  body: unknown,
) {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function writeSseChunk(response: ServerResponse, chunk: unknown) {
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

async function main() {
  let requestCount = 0;
  const requestBodies: string[] = [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      writeJson(response, 404, {}, { error: { message: 'not found' } });
      return;
    }

    requestCount += 1;
    requestBodies.push(await readRequestBody(request));

    if (requestCount === 1) {
      writeJson(
        response,
        503,
        { 'retry-after-ms': '0' },
        { error: { message: 'temporary upstream failure' } },
      );
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    writeSseChunk(response, {
      id: 'chatcmpl-issue-12477',
      object: 'chat.completion.chunk',
      created: 0,
      model: modelId,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'Hello' },
          finish_reason: null,
        },
      ],
    });

    writeSseChunk(response, {
      id: 'chatcmpl-issue-12477',
      object: 'chat.completion.chunk',
      created: 0,
      model: modelId,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    });

    response.end('data: [DONE]\n\n');
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    if (address == null || typeof address === 'string') {
      throw new Error('Expected the test server to listen on a TCP port.');
    }

    const provider = createOpenAICompatible({
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      name: 'moonshot',
      apiKey: 'test-api-key',
    });

    const result = streamText({
      model: provider(modelId),
      prompt: 'Hello',
      maxRetries: 3,
    });

    let text = '';
    let finishEvent: unknown;
    const events: string[] = [];

    for await (const event of result.fullStream) {
      events.push(event.type);

      if (event.type === 'text-delta') {
        text += event.text;
      }

      if (event.type === 'finish') {
        finishEvent = event;
      }
    }

    if (text !== 'Hello') {
      throw new Error(
        `Expected streamed text "Hello", received ${JSON.stringify(text)}.`,
      );
    }

    if (requestCount !== 2) {
      throw new Error(
        `Expected exactly 2 requests after one retry, received ${requestCount}.`,
      );
    }

    if (finishEvent == null) {
      throw new Error(
        `Expected a finish event, received event types: ${events.join(', ')}.`,
      );
    }

    console.log(
      JSON.stringify(
        {
          reproduced: false,
          text,
          requestCount,
          requestBodies,
          events,
          finishEvent,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          reproduced: true,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : error,
          requestCount,
          requestBodies,
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error != null) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
