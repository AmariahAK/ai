import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import fs from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createAnthropic } from './anthropic-provider';

it('respects disableParallelToolUse false in jsonTool mode (issue #15652)', async () => {
  const fixture = await fs.readFile(
    'src/__fixtures__/issue-15652.chunks.txt',
    'utf8',
  );
  const requestBodies: Array<Record<string, unknown>> = [];
  const model = createAnthropic({
    apiKey: 'test-api-key',
    fetch: async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        `${fixture
          .trim()
          .split('\n')
          .map(line => `data: ${line}\n\n`)
          .join('')}data: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  })('claude-sonnet-4-5');

  const { stream } = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    tools: [
      {
        type: 'function',
        name: 'searchDocs',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
          $schema: 'http://json-schema.org/draft-07/schema#',
        },
      },
    ],
    providerOptions: {
      anthropic: {
        structuredOutputMode: 'jsonTool',
        disableParallelToolUse: false,
      },
    },
    responseFormat: {
      type: 'json',
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['items'],
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#',
      },
    },
  });

  await convertReadableStreamToArray(stream);

  const requestBody = requestBodies[0];
  expect(requestBody.tool_choice).toMatchObject({
    disable_parallel_tool_use: false,
  });
  expect(requestBody.tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'searchDocs' }),
      expect.objectContaining({ name: 'json' }),
    ]),
  );
});
