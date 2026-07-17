import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { streamText, type ModelMessage } from '../../ai/dist/index.mjs';
import { createAnthropic } from './anthropic-provider';

describe('Anthropic web-search citation replay', () => {
  const server = createTestServer({
    'https://api.anthropic.com/v1/messages': {},
  });

  it('replays web_search_result_location citations on assistant text', async () => {
    const chunks = fs
      .readFileSync(
        'src/__fixtures__/anthropic-web-search-citation-replay.1.chunks.txt',
        'utf8',
      )
      .trim()
      .split('\n')
      .map(line => `data: ${line}\n\n`);
    chunks.push('data: [DONE]\n\n');

    server.urls['https://api.anthropic.com/v1/messages'].response = {
      type: 'stream-chunks',
      chunks,
    };

    const anthropic = createAnthropic({
      apiKey: 'test-api-key',
    });
    const tools = {
      web_search: anthropic.tools.webSearch_20250305({ maxUses: 3 }),
    };

    const turn1 = streamText({
      model: anthropic('claude-opus-4-8'),
      tools,
      messages: [
        {
          role: 'user',
          content:
            'What did the Federal Reserve decide at its most recent meeting?',
        },
      ],
    });
    await turn1.consumeStream();
    const history: ModelMessage[] = (await turn1.response).messages;

    const turn2 = streamText({
      model: anthropic('claude-opus-4-8'),
      tools,
      messages: [
        ...history,
        {
          role: 'user',
          content: 'What did it decide at the meeting before that?',
        },
      ],
    });
    await turn2.consumeStream();

    const turn2Request = await server.calls[1].requestBodyJson;
    const historicalTextBlocks = turn2Request.messages
      .filter((message: { role: string }) => message.role === 'assistant')
      .flatMap(
        (message: { content: Array<Record<string, unknown>> }) =>
          message.content,
      )
      .filter((part: { type: string }) => part.type === 'text');
    const encryptedContentCount =
      JSON.stringify(turn2Request).match(/"encrypted_content":/g)?.length;
    const citedTextBlockCount = historicalTextBlocks.filter(
      (part: { citations?: unknown[] }) =>
        Array.isArray(part.citations) && part.citations.length > 0,
    ).length;

    expect(encryptedContentCount).toBeGreaterThan(0);
    expect(historicalTextBlocks.length).toBeGreaterThan(0);
    expect(citedTextBlockCount).toBeGreaterThan(0);
  });
});
