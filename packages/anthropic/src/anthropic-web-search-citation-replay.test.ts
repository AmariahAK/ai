import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { streamText, type ModelMessage } from '../../ai/dist/index.mjs';
import { createAnthropic } from './anthropic-provider';

function createFixtureResponse() {
  const chunks = fs
    .readFileSync(
      'src/__fixtures__/anthropic-web-search-citation-replay.1.chunks.txt',
      'utf8',
    )
    .trim()
    .split('\n')
    .map(line => `data: ${line}\n\n`);

  chunks.push('data: [DONE]\n\n');

  return new Response(chunks.join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('Anthropic web-search citation replay', () => {
  it('replays web_search_result_location citations on assistant text blocks', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const anthropic = createAnthropic({
      apiKey: 'test-api-key',
      fetch: async (_url, options) => {
        requests.push(JSON.parse(options?.body as string));
        return createFixtureResponse();
      },
    });
    const model = anthropic('claude-opus-4-8');
    const tools = {
      web_search: anthropic.tools.webSearch_20250305({ maxUses: 3 }),
    };

    const turn1 = streamText({
      model,
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
    const turn1CitationCount = (await turn1.sources).filter(
      source =>
        source.sourceType === 'url' &&
        typeof source.providerMetadata?.anthropic?.encryptedIndex === 'string',
    ).length;

    expect(turn1CitationCount).toBeGreaterThan(0);

    const turn2 = streamText({
      model,
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

    const turn2Request = requests.at(-1) as {
      messages?: Array<{
        role?: string;
        content?: Array<{
          type?: string;
          citations?: unknown[];
        }>;
      }>;
    };
    const replayedTextBlocks =
      turn2Request.messages
        ?.filter(message => message.role === 'assistant')
        .flatMap(message => message.content ?? [])
        .filter(part => part.type === 'text') ?? [];
    const replayedCitationCount = replayedTextBlocks.reduce(
      (count, part) => count + (part.citations?.length ?? 0),
      0,
    );
    const replayedEncryptedContentCount = (
      JSON.stringify(turn2Request).match(/"encrypted_content":/g) ?? []
    ).length;

    expect(replayedEncryptedContentCount).toBeGreaterThan(0);
    expect(replayedCitationCount).toBeGreaterThan(0);
  });
});
