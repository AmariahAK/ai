#!/usr/bin/env node
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createOpenAI } from '../packages/openai/dist/index.js';

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function isFullResponseOutputMessage(item) {
  return (
    item?.type === 'message' &&
    item?.role === 'assistant' &&
    typeof item?.id === 'string' &&
    typeof item?.status === 'string' &&
    Array.isArray(item?.content) &&
    item.content.every(
      part =>
        part?.type === 'output_text' &&
        typeof part?.text === 'string' &&
        Array.isArray(part?.annotations),
    )
  );
}

function isEasyInputAssistantMessage(item) {
  return (
    item?.role === 'assistant' &&
    Array.isArray(item?.content) &&
    item.content.every(part => part?.type === 'input_text')
  );
}

function findStrictResponsesValidationError(body) {
  if (!Array.isArray(body?.input)) {
    return 'input must be an array for this repro';
  }

  const invalidAssistant = body.input.find(
    item =>
      item?.role === 'assistant' &&
      !isEasyInputAssistantMessage(item) &&
      !isFullResponseOutputMessage(item),
  );

  if (invalidAssistant) {
    return (
      'assistant history item is neither EasyInputMessage-style input_text ' +
      'nor a full ResponseOutputMessage with type/status/id'
    );
  }
}

function writeStrictValidationError(response, message) {
  response.writeHead(400, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      error: {
        message: `Invalid request body: [INVALID_ARGUMENT] input must be string or input items (${message})`,
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_request',
      },
    }),
  );
}

function writeMinimalSuccessfulResponsesStream(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });

  const completedResponse = {
    id: 'resp_issue_12754',
    object: 'response',
    created_at: 1741269112,
    status: 'completed',
    error: null,
    incomplete_details: null,
    input: [],
    instructions: null,
    max_output_tokens: null,
    model: 'gpt-5-nano',
    output: [
      {
        id: 'msg_issue_12754',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok', annotations: [] }],
      },
    ],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: null,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    truncation: 'disabled',
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
    user: null,
    metadata: {},
  };

  response.write(
    `data:${JSON.stringify({ type: 'response.completed', response: completedResponse })}\n\n`,
  );
  response.end();
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/responses') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  const rawBody = await readRequestBody(request);
  const body = JSON.parse(rawBody);

  console.log('Captured /v1/responses request body:');
  console.log(JSON.stringify(body, null, 2));

  const validationError = findStrictResponsesValidationError(body);
  if (validationError) {
    writeStrictValidationError(response, validationError);
    return;
  }

  writeMinimalSuccessfulResponsesStream(response);
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');

const { port } = server.address();
const openai = createOpenAI({
  apiKey: 'test-api-key',
  baseURL: `http://127.0.0.1:${port}/v1`,
});

try {
  const result = await openai.responses('gpt-5-nano').doStream({
    prompt: [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
      { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
    ],
    providerOptions: {
      openai: {
        store: false,
        textVerbosity: 'medium',
      },
    },
  });

  for await (const _part of result.stream) {
    // Drain the stream so this script passes if the request shape is fixed.
  }

  console.log(
    'Could not reproduce: strict validator accepted the assistant history payload.',
  );
} catch (error) {
  console.error('\nReproduced issue #12754.');
  console.error(`${error.name}: ${error.message}`);
  console.error(`Status code: ${error.statusCode}`);
  console.error(
    'The SDK serialized assistant text history as role=assistant with content type output_text, which the strict Responses validator rejected.',
  );
  process.exitCode = 1;
} finally {
  server.close();
}
