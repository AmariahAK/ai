import type {
  LanguageModelV2Prompt,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAnthropic } from './anthropic-provider';

const prompt: LanguageModelV2Prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Recorded cache-control reproduction.' }],
    providerOptions: {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    },
  },
];

describe('issue #5942 structured message cache control', () => {
  const server = createTestServer({
    'https://api.anthropic.com/v1/messages': {},
  });
  const model = createAnthropic({
    apiKey: 'test-api-key',
  })('claude-sonnet-4-6');

  async function replayFixture(
    fixtureName: string,
  ): Promise<LanguageModelV2StreamPart> {
    const chunks = fs
      .readFileSync(`src/__fixtures__/${fixtureName}.chunks.txt`, 'utf8')
      .trim()
      .split('\n')
      .map(line => `data: ${line}\n\n`);

    server.urls['https://api.anthropic.com/v1/messages'].response = {
      type: 'stream-chunks',
      chunks,
    };

    const callIndex = server.calls.length;
    const result = await model.doStream({
      prompt,
      maxOutputTokens: 1,
    });
    const streamParts = await convertReadableStreamToArray(result.stream);
    const requestBody = await server.calls[callIndex].requestBodyJson;

    expect(requestBody.messages[0].content[0].cache_control).toEqual({
      type: 'ephemeral',
    });

    const finish = streamParts.find(part => part.type === 'finish');
    expect(finish).toBeDefined();

    return finish!;
  }

  it('forwards cache control and maps cache-write metadata', async () => {
    const finish = await replayFixture('anthropic-issue-5942-cache-write');

    expect(finish.type).toBe('finish');
    if (finish.type !== 'finish') {
      return;
    }

    expect(
      finish.providerMetadata?.anthropic.cacheCreationInputTokens,
    ).toBeGreaterThan(0);
    expect(finish.usage.cachedInputTokens ?? 0).toBe(0);
  });

  it('forwards cache control and maps cache-read metadata', async () => {
    const finish = await replayFixture('anthropic-issue-5942-cache-read');

    expect(finish.type).toBe('finish');
    if (finish.type !== 'finish') {
      return;
    }

    expect(finish.usage.cachedInputTokens).toBeGreaterThan(0);
  });
});
