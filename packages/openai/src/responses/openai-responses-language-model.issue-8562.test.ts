import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OpenAIResponsesLanguageModel } from './openai-responses-language-model';

const prompt: LanguageModelV4Prompt = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Suggest 10 outside activites for a rainy day.',
      },
    ],
  },
];

describe('issue #8562', () => {
  const server = createTestServer({
    'https://api.openai.com/v1/responses': {},
  });

  it('provides reasoning deltas when a reasoning summary is requested', async () => {
    const chunks = fs
      .readFileSync(
        'src/responses/__fixtures__/openai-issue-8562-missing-reasoning-summary.1.chunks.txt',
        'utf8',
      )
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => `data: ${line}\n\n`);
    chunks.push('data: [DONE]\n\n');

    server.urls['https://api.openai.com/v1/responses'].response = {
      type: 'stream-chunks',
      chunks,
    };

    const model = new OpenAIResponsesLanguageModel('o3', {
      provider: 'openai',
      url: ({ path }) => `https://api.openai.com/v1${path}`,
      headers: () => ({ Authorization: 'Bearer APIKEY' }),
    });

    const { stream } = await model.doStream({
      prompt,
      includeRawChunks: false,
      providerOptions: {
        openai: {
          reasoningEffort: 'medium',
          reasoningSummary: 'auto',
        },
      },
    });

    const events = await convertReadableStreamToArray(stream);
    const reasoningDeltas = events.filter(
      event => event.type === 'reasoning-delta',
    );

    expect(reasoningDeltas.length).toBeGreaterThan(0);
  });
});
