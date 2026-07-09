import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let requestCount = 0;
  const requestBodies: unknown[] = [];

  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      requestCount++;

      const body = await readRequestBody(request);
      requestBodies.push(JSON.parse(body));

      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }

      if (requestCount === 1) {
        response.writeHead(503, {
          'content-type': 'application/json',
          'retry-after-ms': '1',
        });
        response.end(
          JSON.stringify({
            error: {
              message: 'transient upstream error',
              type: 'server_error',
            },
          }),
        );
        return;
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const chunks = [
        {
          id: 'chatcmpl-issue-12477',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'kimi-k2.5-free',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-issue-12477',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'kimi-k2.5-free',
          choices: [
            {
              index: 0,
              delta: { content: 'Hello' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-issue-12477',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'kimi-k2.5-free',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        },
      ];

      for (const chunk of chunks) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      response.end('data: [DONE]\n\n');
    },
  );

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    if (address == null || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port.');
    }

    const provider = createOpenAICompatible({
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      name: 'moonshot',
      apiKey: 'test-api-key',
    });

    const result = streamText({
      model: provider('kimi-k2.5-free'),
      prompt: 'Hello',
      maxRetries: 3,
    });

    let text = '';
    const partTypes: string[] = [];

    for await (const part of result.fullStream) {
      partTypes.push(part.type);
      if (part.type === 'text-delta') {
        text += part.text;
      }
    }

    const usage = await result.usage;

    console.log(
      JSON.stringify(
        {
          text,
          usage,
          requestCount,
          requestBodies,
          partTypes,
        },
        null,
        2,
      ),
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) {
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
