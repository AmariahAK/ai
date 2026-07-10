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

it('preserves a provider-executed web fetch error before a client tool call', async () => {
  server.urls['https://api.anthropic.com/v1/messages'].response = {
    type: 'json-value',
    body: JSON.parse(
      fs.readFileSync(
        'src/__fixtures__/anthropic-issue-10819-web-fetch-error.1.json',
        'utf8',
      ),
    ),
  };

  const provider = createAnthropic({ apiKey: 'test-api-key' });
  const result = await provider('claude-sonnet-4-5-20250929').doGenerate({
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Run both tools.' }],
      },
    ],
    tools: [
      {
        type: 'provider',
        id: 'anthropic.web_fetch_20250910',
        name: 'web_fetch',
        args: { maxUses: 1 },
      },
      {
        type: 'function',
        name: 'display_products',
        description: 'Record that product display was attempted.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  });

  expect(result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'srvtoolu_01M4mXhDsUwdg47obxPH4ZAQ',
        toolName: 'web_fetch',
        providerExecuted: true,
      }),
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'srvtoolu_01M4mXhDsUwdg47obxPH4ZAQ',
        toolName: 'web_fetch',
        result: {
          type: 'web_fetch_tool_result_error',
          errorCode: 'url_not_accessible',
        },
        isError: true,
      }),
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'toolu_01M48QRiAhRAtxKfsCrc831L',
        toolName: 'display_products',
      }),
    ]),
  );
});
