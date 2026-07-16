import {
  convertReadableStreamToArray,
  mockId,
} from '@ai-sdk/provider-utils/test';
import fs from 'node:fs';
import { expect, it } from 'vitest';
import type { AnthropicLanguageModelOptions } from './anthropic-language-model-options';
import { createAnthropic } from './anthropic-provider';

type AnthropicRequestBody = {
  tool_choice?: {
    disable_parallel_tool_use?: boolean;
  };
};

function loadLiveResponseFixture(disableParallelToolUse: boolean) {
  const filename = disableParallelToolUse
    ? 'anthropic-issue-15652.chunks.txt'
    : 'anthropic-issue-15652-false.chunks.txt';
  const chunks = fs.readFileSync(
    new URL(`./__fixtures__/${filename}`, import.meta.url),
    'utf8',
  );

  return `${chunks
    .trim()
    .split('\n')
    .map(line => `data: ${line}\n\n`)
    .join('')}data: [DONE]\n\n`;
}

it('respects disableParallelToolUse=false with jsonTool structured output', async () => {
  let requestBody: AnthropicRequestBody | undefined;
  const provider = createAnthropic({
    apiKey: 'test-api-key',
    generateId: mockId({ prefix: 'id' }),
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as AnthropicRequestBody;
      const disableParallelToolUse =
        requestBody.tool_choice?.disable_parallel_tool_use === true;

      return new Response(loadLiveResponseFixture(disableParallelToolUse), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });

  const { stream } = await provider('claude-sonnet-4-5').doStream({
    prompt: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Call searchDocs exactly 3 times in parallel in this response, with the distinct queries alpha, beta, and gamma. Do not call the json tool yet.',
          },
        ],
      },
    ],
    tools: [
      {
        type: 'function',
        name: 'searchDocs',
        description: 'Search documentation for one query.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
      },
    ],
    responseFormat: {
      type: 'json',
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
    providerOptions: {
      anthropic: {
        structuredOutputMode: 'jsonTool',
        disableParallelToolUse: false,
      } satisfies AnthropicLanguageModelOptions,
    },
  });

  const chunks = await convertReadableStreamToArray(stream);
  const toolCalls = chunks.filter(chunk => chunk.type === 'tool-call');

  expect(
    toolCalls,
    'The live false-option fixture contains three parallel searchDocs calls',
  ).toHaveLength(3);
  expect(requestBody?.tool_choice?.disable_parallel_tool_use).toBe(false);
});
