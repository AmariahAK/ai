import type { LanguageModelV3Prompt } from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import * as fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGoogleGenerativeAI } from './google-provider';

const testUrl =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent';

const server = createTestServer({
  [testUrl]: {},
});

const prompt: LanguageModelV3Prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Create an image of the moon.' }],
  },
];

it('preserves an image thought signature from a recorded Gemini 3 stream', async () => {
  const chunks = fs
    .readFileSync(
      'src/__fixtures__/issue-10660-image-thought-signature.chunks.txt',
      'utf8',
    )
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => `data: ${line}\n\n`);

  server.urls[testUrl].response = {
    type: 'stream-chunks',
    chunks,
  };

  const google = createGoogleGenerativeAI({
    apiKey: 'test-api-key',
  });
  const model = google.chat('gemini-3-pro-image-preview');
  const { stream } = await model.doStream({
    prompt,
    includeRawChunks: false,
  });

  const events = await convertReadableStreamToArray(stream);
  const fileEvents = events.filter(event => event.type === 'file');

  expect(fileEvents).toHaveLength(1);
  expect(fileEvents[0]).toMatchObject({
    type: 'file',
    mediaType: 'image/jpeg',
    data: 'recorded-image-data-omitted',
  });
  expect(fileEvents[0]?.providerMetadata?.google?.thoughtSignature).toEqual(
    expect.any(String),
  );
  expect(
    String(fileEvents[0]?.providerMetadata?.google?.thoughtSignature).length,
  ).toBeGreaterThan(1000);
});
