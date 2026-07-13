import fs from 'node:fs';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { describe, expect, it } from 'vitest';
import { createOpenAICompatible } from '../openai-compatible-provider';

const url = 'https://api.mistral.ai/v1/chat/completions';
const server = createTestServer({ [url]: {} });
const model = createOpenAICompatible({
  baseURL: 'https://api.mistral.ai/v1',
  name: 'mistral',
})('mistral-small-latest');

const prompt: LanguageModelV4Prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'What is 17 * 23?' }],
  },
];

describe('issue #13703: content arrays with thinking parts', () => {
  it('normalizes non-stream thinking and text parts', async () => {
    const body = JSON.parse(
      fs.readFileSync(
        'src/chat/__fixtures__/issue-13703-mistral-thinking.json',
        'utf8',
      ),
    );
    body.choices[0].message.content.splice(1, 0, {
      type: 'provider-specific',
      value: 'ignored',
    });

    server.urls[url].response = {
      type: 'json-value',
      body,
    };

    const result = await model.doGenerate({ prompt });

    expect(result.content).toEqual([
      {
        type: 'reasoning',
        text: expect.stringContaining('17 multiplied by 23'),
      },
      { type: 'text', text: '391' },
    ]);
  });

  it('normalizes streamed thinking and text parts without error events', async () => {
    const chunks = fs
      .readFileSync(
        'src/chat/__fixtures__/issue-13703-mistral-thinking.chunks.txt',
        'utf8',
      )
      .trim()
      .split('\n')
      .map(line => `data: ${line}\n\n`);
    chunks.splice(
      2,
      0,
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              content: [{ type: 'provider-specific', value: 'ignored' }],
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
    chunks.push('data: [DONE]\n\n');

    server.urls[url].response = {
      type: 'stream-chunks',
      chunks,
    };

    const { stream } = await model.doStream({ prompt });
    const events = await convertReadableStreamToArray(stream);

    expect(events.filter(event => event.type === 'error')).toEqual([]);
    expect(
      events
        .filter(event => event.type === 'reasoning-delta')
        .map(event => event.delta),
    ).toEqual(['The', ' user is asking a']);
    expect(
      events
        .filter(event => event.type === 'text-delta')
        .map(event => event.delta),
    ).toEqual(['4']);
  });
});
