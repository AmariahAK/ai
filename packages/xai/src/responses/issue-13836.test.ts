import type { LanguageModelV3Prompt } from '@ai-sdk/provider';
import {
  convertReadableStreamToArray,
  mockId,
} from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { XaiResponsesLanguageModel } from './xai-responses-language-model';

const fixtureName = 'issue-13836-xai-responses-missing-tail';
const fixturePath = `src/responses/__fixtures__/${fixtureName}.chunks.txt`;
const prompt: LanguageModelV3Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'hello' }] },
];

type FixtureEvent = {
  type?: string;
  item?: {
    type?: string;
    content?: Array<{ text?: string }>;
  };
};

describe('issue #13836', () => {
  const server = createTestServer({
    'https://api.x.ai/v1/responses': {},
  });

  it('preserves the complete text from the recorded xAI stream', async () => {
    const fixtureLines = fs
      .readFileSync(fixturePath, 'utf8')
      .trim()
      .split('\n');
    const events = fixtureLines.map(line => JSON.parse(line) as FixtureEvent);
    let completedMessage: FixtureEvent['item'];
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (
        event?.type === 'response.output_item.done' &&
        event.item?.type === 'message'
      ) {
        completedMessage = event.item;
        break;
      }
    }

    expect(completedMessage).toBeDefined();
    const completedText = (completedMessage?.content ?? [])
      .map(content => content.text ?? '')
      .join('');

    server.urls['https://api.x.ai/v1/responses'].response = {
      type: 'stream-chunks',
      chunks: fixtureLines
        .map(line => `data: ${line}\n\n`)
        .concat('data: [DONE]\n\n'),
    };

    const model = new XaiResponsesLanguageModel('grok-4-1-fast-non-reasoning', {
      provider: 'xai.responses',
      baseURL: 'https://api.x.ai/v1',
      headers: () => ({ Authorization: 'Bearer test-key' }),
      generateId: mockId(),
    });
    const { stream } = await model.doStream({ prompt });
    const parts = await convertReadableStreamToArray(stream);
    const streamedText = parts
      .filter(part => part.type === 'text-delta')
      .map(part => part.delta)
      .join('');

    expect(streamedText).toBe(completedText);
    expect(streamedText).toHaveLength(8792);
    expect(streamedText.trimEnd()).toMatch(/END_OK_9981$/);
  });
});
