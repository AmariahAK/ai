import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, type ModelMessage } from 'ai';

type AnthropicTextBlock = {
  type: 'text';
  text: string;
  citations?: unknown[];
};

type AnthropicRequestBody = {
  messages?: Array<{
    role: string;
    content: Array<{ type: string } & Record<string, unknown>>;
  }>;
};

async function main() {
  const requestBodies: AnthropicRequestBody[] = [];

  const anthropic = createAnthropic({
    fetch: async (input, init) => {
      if (typeof init?.body === 'string') {
        requestBodies.push(JSON.parse(init.body) as AnthropicRequestBody);
      }

      return fetch(input, init);
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
        content: 'What did the Fed decide at its most recent meeting?',
      },
    ],
  });
  await turn1.consumeStream();

  const turn1Sources = await turn1.sources;
  const history: ModelMessage[] = (await turn1.response).messages;

  if (
    !turn1Sources.some(
      source =>
        source.providerMetadata?.anthropic?.encryptedIndex != null &&
        source.providerMetadata.anthropic.citedText != null,
    )
  ) {
    throw new Error(
      'Live turn 1 did not return a web_search_result_location citation.',
    );
  }

  const turn2 = streamText({
    model,
    tools,
    messages: [
      ...history,
      {
        role: 'user',
        content: 'And what did it decide at the meeting before that?',
      },
    ],
  });
  await turn2.consumeStream();
  const turn2Sources = await turn2.sources;

  const turn2Request = requestBodies.at(-1);
  const replayedAssistantTextBlocks = (turn2Request?.messages ?? [])
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.content)
    .filter(
      (part): part is AnthropicTextBlock =>
        part.type === 'text' && typeof part.text === 'string',
    );

  if (replayedAssistantTextBlocks.length === 0) {
    throw new Error('Turn 2 request did not replay assistant text.');
  }

  if (
    replayedAssistantTextBlocks.some(
      part => Array.isArray(part.citations) && part.citations.length > 0,
    )
  ) {
    console.log(
      'PASS: Turn 2 replay preserved web_search_result_location citations.',
    );
    return;
  }

  console.error(
    'BUG REPRODUCED: Turn 2 replayed cited assistant text without a citations array.',
  );
  console.error(`Turn 2 returned ${turn2Sources.length} citation source(s).`);
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
