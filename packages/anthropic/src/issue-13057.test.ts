import type { LanguageModelV3Prompt } from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createAnthropic } from './anthropic-provider';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

const server = createTestServer({
  'https://api.anthropic.com/v1/messages': {},
});

it('sends an immediate matching tool_result after an approved tool call', async () => {
  server.urls['https://api.anthropic.com/v1/messages'].response = {
    type: 'stream-chunks',
    chunks: fs
      .readFileSync(
        'src/__fixtures__/issue-13057-approved-tool.2.chunks.txt',
        'utf8',
      )
      .split('\n')
      .filter(Boolean)
      .map(line => `data: ${line}\n\n`),
  };

  const model = createAnthropic({ apiKey: 'test-api-key' })(
    'claude-sonnet-4-5',
  );

  const prompt: LanguageModelV3Prompt = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Create an issue titled Reproduction.' }],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'toolu_issue_13057',
          toolName: 'createIssue',
          input: { title: 'Reproduction' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'toolu_issue_13057',
          toolName: 'createIssue',
          output: {
            type: 'json',
            value: { id: '123', title: 'Reproduction' },
          },
        },
      ],
    },
  ];

  const { stream } = await model.doStream({
    prompt,
    tools: [
      {
        type: 'function',
        name: 'createIssue',
        description: 'Create an issue with the requested title.',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
          additionalProperties: false,
        },
      },
    ],
    toolChoice: { type: 'none' },
  });

  await convertReadableStreamToArray(stream);

  const request = await server.calls[0].requestBodyJson;
  expect(request.messages).toEqual([
    {
      role: 'user',
      content: [{ type: 'text', text: 'Create an issue titled Reproduction.' }],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_issue_13057',
          name: 'createIssue',
          input: { title: 'Reproduction' },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_issue_13057',
          content: JSON.stringify({ id: '123', title: 'Reproduction' }),
        },
      ],
    },
  ]);
});
