import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, type ModelMessage } from 'ai';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function getCitationCount(sources: Awaited<ReturnType<typeof getSources>>) {
  return sources.filter(
    source =>
      source.sourceType === 'url' &&
      typeof source.providerMetadata?.anthropic?.encryptedIndex === 'string',
  ).length;
}

async function getSources(result: ReturnType<typeof streamText>) {
  return await result.sources;
}

function getSseJsonLines(body: string) {
  return body
    .split('\n')
    .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map(line => line.slice('data: '.length))
    .join('\n');
}

async function main() {
  const requests: Array<Record<string, unknown>> = [];
  const responses: string[] = [];

  const anthropic = createAnthropic({
    fetch: async (url, options) => {
      requests.push(JSON.parse(options?.body as string));

      const response = await fetch(url, options);
      responses.push(await response.clone().text());
      return response;
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
          'Search the web and tell me what the Federal Reserve decided at its most recent meeting. Cite every factual claim.',
      },
    ],
  });

  await turn1.consumeStream();

  const turn1CitationCount = getCitationCount(await turn1.sources);
  const history: ModelMessage[] = (await turn1.response).messages;

  if (turn1CitationCount === 0) {
    throw new Error(
      'Turn 1 did not return any web_search_result_location citations.',
    );
  }

  if (process.env.RECORD_ANTHROPIC_FIXTURE === '1') {
    const fixturePath = fileURLToPath(
      new URL(
        '../../../../packages/anthropic/src/__fixtures__/anthropic-web-search-citation-replay.1.chunks.txt',
        import.meta.url,
      ),
    );
    await writeFile(fixturePath, `${getSseJsonLines(responses[0])}\n`);
  }

  const turn2 = streamText({
    model,
    tools,
    messages: [
      ...history,
      {
        role: 'user',
        content:
          'Search the web and tell me what it decided at the meeting before that. Cite every factual claim.',
      },
    ],
  });

  await turn2.consumeStream();
  const turn2CitationCount = getCitationCount(await turn2.sources);

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

  console.log(
    JSON.stringify(
      {
        turn1CitationCount,
        replayedTextBlockCount: replayedTextBlocks.length,
        replayedCitationCount,
        replayedEncryptedContentCount,
        turn2CitationCount,
        turn2Completed: true,
      },
      null,
      2,
    ),
  );

  if (replayedEncryptedContentCount === 0) {
    throw new Error(
      'Turn 2 did not preserve web-search encrypted_content, so the reported citation-only data loss was not isolated.',
    );
  }

  if (replayedCitationCount === 0) {
    console.error(
      'ISSUE_17379_REPRODUCED: turn-2 historical assistant text dropped Anthropic web_search_result_location citations',
    );
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
