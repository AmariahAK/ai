import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnthropicLanguageModelOptions } from './anthropic-messages-options';
import { createAnthropic } from './anthropic-provider';

describe('issue #15652', () => {
  const server = createTestServer({
    'https://api.anthropic.com/v1/messages': {},
  });

  it('replays the live response with only one real tool call', async () => {
    const chunks = fs
      .readFileSync(
        'src/__fixtures__/anthropic-issue-15652-json-tool-parallel.chunks.txt',
        'utf8',
      )
      .split('\n')
      .map(line => `data: ${line}\n\n`);

    server.urls['https://api.anthropic.com/v1/messages'].response = {
      type: 'stream-chunks',
      chunks,
    };

    const provider = createAnthropic({ apiKey: 'test-api-key' });
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
          description:
            'Search documentation. Call this once for each requested query.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
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
        },
      },
      providerOptions: {
        anthropic: {
          structuredOutputMode: 'jsonTool',
          disableParallelToolUse: false,
        } satisfies AnthropicLanguageModelOptions,
      },
    });

    const parts = await convertReadableStreamToArray(stream);
    const toolCalls = parts.filter(part => part.type === 'tool-call');

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      type: 'tool-call',
      toolName: 'searchDocs',
      input: '{"query": "alpha"}',
    });
    expect(await server.calls[0].requestBodyJson).toMatchObject({
      tool_choice: {
        type: 'any',
        disable_parallel_tool_use: true,
      },
    });
  });
});
