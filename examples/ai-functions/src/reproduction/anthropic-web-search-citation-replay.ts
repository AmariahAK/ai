import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, type ModelMessage } from 'ai';
import { writeFile } from 'node:fs/promises';

const fixturePath =
  '../../packages/anthropic/src/__fixtures__/anthropic-web-search-citation-replay.1.chunks.txt';

function countKey(value: unknown, key: string): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countKey(item, key), 0);
  }

  if (value != null && typeof value === 'object') {
    return Object.entries(value).reduce(
      (total, [entryKey, entryValue]) =>
        total + (entryKey === key ? 1 : 0) + countKey(entryValue, key),
      0,
    );
  }

  return 0;
}

function toChunksFixture(sse: string): string {
  return (
    sse
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => line.slice('data: '.length))
      .filter(line => line !== '[DONE]')
      .join('\n') + '\n'
  );
}

async function main() {
  const requestBodies: Array<Record<string, unknown>> = [];
  const responseBodies: Array<Promise<string>> = [];

  const provider = createAnthropic({
    fetch: async (input, init) => {
      if (typeof init?.body === 'string') {
        requestBodies.push(JSON.parse(init.body));
      }

      const response = await fetch(input, init);
      responseBodies.push(response.clone().text());
      return response;
    },
  });

  const tools = {
    web_search: provider.tools.webSearch_20250305({ maxUses: 3 }),
  };

  const turn1 = streamText({
    model: provider('claude-opus-4-8'),
    tools,
    messages: [
      {
        role: 'user',
        content:
          'Search the web and answer with citations: What did the Federal Reserve decide at its most recent meeting?',
      },
    ],
  });

  await turn1.consumeStream();
  const history: ModelMessage[] = (await turn1.response).messages;
  const turn1Raw = await responseBodies[0];

  if (process.env.RECORD_FIXTURE === '1') {
    await writeFile(fixturePath, toChunksFixture(turn1Raw));
  }

  const turn2 = streamText({
    model: provider('claude-opus-4-8'),
    tools,
    messages: [
      ...history,
      {
        role: 'user',
        content:
          'Search the web and answer with citations: What did it decide at the meeting before that?',
      },
    ],
  });

  await turn2.consumeStream();
  await turn2.response;
  const turn2Raw = await responseBodies[1];

  const rawTurn1CitationCount = (
    turn1Raw.match(/"type":"web_search_result_location"/g) ?? []
  ).length;
  const rawTurn2CitationCount = (
    turn2Raw.match(/"type":"web_search_result_location"/g) ?? []
  ).length;

  const turn2Request = requestBodies[1] as {
    messages?: Array<{
      role?: string;
      content?: Array<Record<string, unknown>>;
    }>;
  };
  const historicalAssistantTextBlocks =
    turn2Request.messages
      ?.filter(message => message.role === 'assistant')
      .flatMap(message => message.content ?? [])
      .filter(part => part.type === 'text') ?? [];
  const citedHistoricalTextBlocks = historicalAssistantTextBlocks.filter(
    part => Array.isArray(part.citations) && part.citations.length > 0,
  );
  const encryptedContentCount = countKey(turn2Request, 'encrypted_content');

  console.log(
    JSON.stringify(
      {
        rawTurn1CitationCount,
        historicalAssistantTextBlockCount: historicalAssistantTextBlocks.length,
        citedHistoricalTextBlockCount: citedHistoricalTextBlocks.length,
        encryptedContentCount,
        turn2Completed: true,
        rawTurn2CitationCount,
      },
      null,
      2,
    ),
  );

  if (
    rawTurn1CitationCount > 0 &&
    historicalAssistantTextBlocks.length > 0 &&
    citedHistoricalTextBlocks.length === 0 &&
    encryptedContentCount > 0
  ) {
    console.error(
      'REPRODUCED: turn-2 replay dropped Anthropic web_search_result_location citations',
    );
    process.exitCode = 1;
    return;
  }

  throw new Error(
    'Could not establish citation replay loss from the live Anthropic responses and turn-2 request.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
