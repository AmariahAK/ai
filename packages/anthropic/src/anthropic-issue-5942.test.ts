import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import {
  convertReadableStreamToArray,
  mockId,
} from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAnthropic } from './anthropic-provider';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

describe('issue #5942', () => {
  const server = createTestServer({
    'https://api.anthropic.com/v1/messages': {},
  });
  const provider = createAnthropic({
    apiKey: 'test-api-key',
    generateId: mockId({ prefix: 'id' }),
  });

  function prepareChunksFixtureResponse(filename: string) {
    const chunks = fs
      .readFileSync(`src/__fixtures__/${filename}.chunks.txt`, 'utf8')
      .split('\n')
      .map(line => `data: ${line}\n\n`);
    chunks.push('data: [DONE]\n\n');

    server.urls['https://api.anthropic.com/v1/messages'].response = {
      type: 'stream-chunks',
      chunks,
    };
  }

  it('applies message cache control to structured content and exposes live cache usage', async () => {
    const prompt: LanguageModelV4Prompt = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'recorded long prompt' }],
        providerOptions: {
          anthropic: {
            cacheControl: { type: 'ephemeral' },
          },
        },
      },
    ];
    const model = provider('claude-sonnet-4-6');

    prepareChunksFixtureResponse('anthropic-issue-5942-cache-write');
    const firstResult = await model.doStream({ prompt, maxOutputTokens: 2 });
    const firstParts = await convertReadableStreamToArray(firstResult.stream);

    expect(await server.calls[0].requestBodyJson).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'recorded long prompt',
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    });
    expect(firstParts.find(part => part.type === 'finish')).toMatchObject({
      providerMetadata: {
        anthropic: {
          usage: {
            cache_creation_input_tokens: 17603,
            cache_read_input_tokens: 0,
          },
        },
      },
    });

    prepareChunksFixtureResponse('anthropic-issue-5942-cache-read');
    const secondResult = await model.doStream({ prompt, maxOutputTokens: 2 });
    const secondParts = await convertReadableStreamToArray(secondResult.stream);

    expect(secondParts.find(part => part.type === 'finish')).toMatchObject({
      providerMetadata: {
        anthropic: {
          usage: {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 17603,
          },
        },
      },
    });
  });
});
