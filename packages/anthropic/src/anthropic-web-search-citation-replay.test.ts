import type {
  LanguageModelV4Prompt,
  LanguageModelV4ProviderTool,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createAnthropic } from './anthropic-provider';

const server = createTestServer({
  'https://api.anthropic.com/v1/messages': {},
});

const provider = createAnthropic({ apiKey: 'test-api-key' });
const model = provider('claude-opus-4-8');
const tools: LanguageModelV4ProviderTool[] = [
  {
    type: 'provider',
    id: 'anthropic.web_search_20250305',
    name: 'web_search',
    args: { maxUses: 3 },
  },
];

function prepareLiveFixtureResponse() {
  server.urls['https://api.anthropic.com/v1/messages'].response = {
    type: 'stream-chunks',
    chunks: [
      fs.readFileSync(
        'src/__fixtures__/anthropic-web-search-citation-replay.1.chunks.txt',
        'utf8',
      ),
    ],
  };
}

function replayableAssistantContent(
  parts: LanguageModelV4StreamPart[],
): Extract<LanguageModelV4Prompt[number], { role: 'assistant' }>['content'] {
  const content: Extract<
    LanguageModelV4Prompt[number],
    { role: 'assistant' }
  >['content'] = [];
  let text = '';
  const providerToolCallIds = new Set<string>();

  for (const part of parts) {
    switch (part.type) {
      case 'text-start':
        text = '';
        break;
      case 'text-delta':
        text += part.delta;
        break;
      case 'text-end':
        if (text !== '') {
          content.push({ type: 'text', text });
        }
        text = '';
        break;
      case 'tool-call':
        if (part.providerExecuted) {
          providerToolCallIds.add(part.toolCallId);
          content.push({
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: JSON.parse(part.input),
            providerExecuted: true,
            providerOptions: part.providerMetadata,
          });
        }
        break;
      case 'tool-result':
        if (providerToolCallIds.has(part.toolCallId) && !part.preliminary) {
          content.push({
            type: 'tool-result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: { type: 'json', value: part.result },
            providerOptions: part.providerMetadata,
          });
        }
        break;
    }
  }

  return content;
}

it('preserves web search citations when replaying assistant content', async () => {
  prepareLiveFixtureResponse();
  const turn1 = await model.doStream({
    prompt: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What did the Fed decide at its most recent meeting?',
          },
        ],
      },
    ],
    tools,
  });
  const turn1Parts = await convertReadableStreamToArray(turn1.stream);

  expect(
    turn1Parts.some(
      part =>
        part.type === 'source' &&
        part.providerMetadata?.anthropic?.encryptedIndex != null,
    ),
  ).toBe(true);

  prepareLiveFixtureResponse();
  await model.doStream({
    prompt: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What did the Fed decide at its most recent meeting?',
          },
        ],
      },
      {
        role: 'assistant',
        content: replayableAssistantContent(turn1Parts),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'And what did it decide at the meeting before that?',
          },
        ],
      },
    ],
    tools,
  });

  const turn2Request = await server.calls[1].requestBodyJson;
  const replayedAssistant = turn2Request.messages.find(
    (message: { role: string }) => message.role === 'assistant',
  );

  const replayedSearchResult = replayedAssistant.content.find(
    (part: { type: string }) => part.type === 'web_search_tool_result',
  );
  expect(
    replayedSearchResult.content.some(
      (result: { encrypted_content?: unknown }) =>
        typeof result.encrypted_content === 'string' &&
        result.encrypted_content.length > 0,
    ),
  ).toBe(true);

  expect(
    replayedAssistant.content
      .filter((part: { type: string }) => part.type === 'text')
      .some(
        (part: { citations?: unknown[] }) =>
          Array.isArray(part.citations) && part.citations.length > 0,
      ),
  ).toBe(true);
});
