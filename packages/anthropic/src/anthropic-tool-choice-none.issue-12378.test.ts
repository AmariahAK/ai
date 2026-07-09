import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAnthropic } from './anthropic-provider';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

const promptWithToolHistory: LanguageModelV4Prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Search for climate change' }],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'toolu_01_issue12378',
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
        toolCallId: 'toolu_01_issue12378',
        toolName: 'search',
        output: {
          type: 'text',
          value:
            'Climate change is a long-term shift in temperatures and weather patterns.',
        },
      },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Now summarize what you found in one sentence.' },
    ],
  },
];

describe('issue #12378: toolChoice none with Anthropic tool history', () => {
  const server = createTestServer({
    'https://api.anthropic.com/v1/messages': {},
  });

  it('should keep tools and send tool_choice none', async () => {
    server.urls['https://api.anthropic.com/v1/messages'].response = {
      type: 'json-value',
      body: JSON.parse(
        fs.readFileSync(
          'src/__fixtures__/anthropic-tool-choice-none-with-tool-history.1.json',
          'utf8',
        ),
      ),
    };

    const model = createAnthropic({
      apiKey: 'test-api-key',
    })('claude-sonnet-4-6');

    await model.doGenerate({
      prompt: promptWithToolHistory,
      maxOutputTokens: 64,
      tools: [
        {
          type: 'function',
          name: 'search',
          description: 'Search for information',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      toolChoice: { type: 'none' },
    });

    await expect(server.calls[0].requestBodyJson).resolves.toMatchObject({
      tools: [
        {
          name: 'search',
          description: 'Search for information',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      tool_choice: { type: 'none' },
    });
  });
});
