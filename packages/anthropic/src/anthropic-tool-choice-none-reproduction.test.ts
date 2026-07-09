import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { mockId } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAnthropic } from './anthropic-provider';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

const provider = createAnthropic({
  apiKey: 'test-api-key',
  generateId: mockId({ prefix: 'id' }),
});

const prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Search for climate change.' }],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'toolu_repro_123',
        toolName: 'search',
        input: { query: 'climate change' },
      },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'toolu_repro_123',
        toolName: 'search',
        output: {
          type: 'text',
          value:
            'Climate change refers to long-term shifts in temperatures and weather patterns.',
        },
      },
    ],
  },
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Now summarize what you found in one sentence.',
      },
    ],
  },
] satisfies LanguageModelV4Prompt;

describe('issue #12378 reproduction', () => {
  const server = createTestServer({
    'https://api.anthropic.com/v1/messages': {},
  });

  it('should retain tools and send tool_choice none when tool_use/tool_result history is present', async () => {
    server.urls['https://api.anthropic.com/v1/messages'].response = {
      type: 'json-value',
      body: JSON.parse(
        fs.readFileSync(
          'src/__fixtures__/anthropic-tool-choice-none-history.json',
          'utf8',
        ),
      ),
    };

    await provider('claude-sonnet-4-5').doGenerate({
      tools: [
        {
          type: 'function',
          name: 'search',
          description: 'Search for information',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
        },
      ],
      toolChoice: { type: 'none' },
      prompt,
    });

    expect(await server.calls[0].requestBodyJson).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Search for climate change.' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_repro_123',
              name: 'search',
              input: { query: 'climate change' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_repro_123',
              content:
                'Climate change refers to long-term shifts in temperatures and weather patterns.',
            },
            {
              type: 'text',
              text: 'Now summarize what you found in one sentence.',
            },
          ],
        },
      ],
      tools: [
        {
          name: 'search',
          description: 'Search for information',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: 'none' },
    });
  });
});
