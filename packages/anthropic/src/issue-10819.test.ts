import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { generateText, stepCountIs, tool } from 'ai';
import fs from 'node:fs';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAnthropic } from './anthropic-provider';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

const server = createTestServer({
  'https://api.anthropic.com/v1/messages': {},
});

it('continues after a provider-executed web fetch error before a client tool call', async () => {
  server.urls['https://api.anthropic.com/v1/messages'].response = [1, 2].map(
    fixtureNumber => ({
      type: 'json-value' as const,
      body: JSON.parse(
        fs.readFileSync(
          `src/__fixtures__/anthropic-issue-10819-web-fetch-error.${fixtureNumber}.json`,
          'utf8',
        ),
      ),
    }),
  );

  const anthropic = createAnthropic({ apiKey: 'test-api-key' });
  const result = await generateText({
    model: anthropic('claude-sonnet-4-5-20250929'),
    maxOutputTokens: 512,
    prompt: 'Run web_fetch and then display_products.',
    tools: {
      web_fetch: anthropic.tools.webFetch_20250910({
        maxUses: 1,
      }),
      display_products: tool({
        description:
          'Record that product display was attempted after the web fetch.',
        inputSchema: z.object({}),
        execute: async () => ({ displayed: true }),
      }),
    },
    stopWhen: stepCountIs(4),
  });

  expect(result.text.trim()).toMatch(/DONE$/);

  const continuationRequest = await server.calls[1].requestBodyJson;
  expect(continuationRequest.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'web_fetch_tool_result',
            tool_use_id: 'srvtoolu_01YLvnKz3B4whrw1vbfoMEbn',
            content: {
              type: 'web_fetch_tool_result_error',
              error_code: 'url_not_accessible',
            },
          }),
        ]),
      }),
    ]),
  );
});
