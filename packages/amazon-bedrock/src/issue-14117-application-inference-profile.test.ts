import type { LanguageModelV3Prompt } from '@ai-sdk/provider';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BedrockChatLanguageModel } from './bedrock-chat-language-model';

const modelId =
  'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123xyz';
const baseUrl = 'https://bedrock-runtime.us-east-1.amazonaws.com';
const expectedUrl = `${baseUrl}/model/${encodeURIComponent(modelId)}/converse`;
const prompt: LanguageModelV3Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Say hello' }] },
];

describe('issue 14117', () => {
  it('generates text with an application inference profile ARN', async () => {
    const fixture = fs.readFileSync(
      'src/__fixtures__/issue-14117-application-inference-profile-success.json',
      'utf8',
    );
    let requestUrl: string | undefined;
    const model = new BedrockChatLanguageModel(modelId, {
      baseUrl: () => baseUrl,
      headers: {},
      fetch: async input => {
        requestUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;

        return new Response(fixture, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      generateId: () => 'test-id',
    });

    const result = await model.doGenerate({ prompt });

    expect(requestUrl).toBe(expectedUrl);
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
  });
});
