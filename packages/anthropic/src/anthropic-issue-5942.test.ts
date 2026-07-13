import type { LanguageModelV3Prompt } from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { AnthropicLanguageModelOptions } from './anthropic-messages-options';
import { createAnthropic } from './anthropic-provider';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

const server = createTestServer({
  'https://api.anthropic.com/v1/messages': {},
});

const provider = createAnthropic({
  apiKey: 'test-api-key',
});

const prompt: LanguageModelV3Prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Long cached structured content' }],
    providerOptions: {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      } satisfies AnthropicLanguageModelOptions,
    },
  },
];

function prepareChunksFixtureResponse(filename: string) {
  const chunks = fs
    .readFileSync(`src/__fixtures__/${filename}.chunks.txt`, 'utf8')
    .trim()
    .split('\n')
    .map(line => `data: ${line}\n\n`);

  server.urls['https://api.anthropic.com/v1/messages'].response = {
    type: 'stream-chunks',
    chunks,
  };
}

async function streamFixture(filename: string) {
  prepareChunksFixtureResponse(filename);

  const { stream } = await provider('claude-sonnet-4-6').doStream({
    prompt,
    maxOutputTokens: 8,
  });

  return convertReadableStreamToArray(stream);
}

it('forwards message-level cache control for structured content and exposes live cache usage', async () => {
  const cacheWriteStream = await streamFixture(
    'anthropic-issue-5942-cache-write',
  );

  expect(await server.calls[0].requestBodyJson).toMatchObject({
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Long cached structured content',
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ],
  });

  expect(cacheWriteStream.at(-1)).toMatchObject({
    type: 'finish',
    usage: {
      inputTokens: {
        cacheRead: 0,
      },
    },
    providerMetadata: {
      anthropic: {
        usage: {
          cache_read_input_tokens: 0,
        },
      },
    },
  });
  const cacheWriteFinish = cacheWriteStream.find(
    part => part.type === 'finish',
  );
  expect(cacheWriteFinish?.usage.inputTokens.cacheWrite).toBeGreaterThan(0);
  expect(cacheWriteFinish?.providerMetadata?.anthropic?.usage).toMatchObject({
    cache_creation_input_tokens: cacheWriteFinish?.usage.inputTokens.cacheWrite,
  });

  const cacheReadStream = await streamFixture(
    'anthropic-issue-5942-cache-read',
  );

  expect(cacheReadStream.at(-1)).toMatchObject({
    type: 'finish',
    usage: {
      inputTokens: {
        cacheWrite: 0,
      },
    },
    providerMetadata: {
      anthropic: {
        usage: {
          cache_creation_input_tokens: 0,
        },
      },
    },
  });
  const cacheReadFinish = cacheReadStream.find(part => part.type === 'finish');
  expect(cacheReadFinish?.usage.inputTokens.cacheRead).toBeGreaterThan(0);
  expect(cacheReadFinish?.providerMetadata?.anthropic?.usage).toMatchObject({
    cache_read_input_tokens: cacheReadFinish?.usage.inputTokens.cacheRead,
  });
});
