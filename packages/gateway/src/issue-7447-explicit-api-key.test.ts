import type { LanguageModelV2Prompt } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { createGatewayProvider } from './gateway-provider';
// @ts-ignore - Vitest loads the recorded JSON fixture.
import liveResponse from './__fixtures__/issue-7447-live-generate-response.json';

const prompt: LanguageModelV2Prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Reply with exactly gateway-ok.' }],
  },
];

describe('issue #7447 explicit API key', () => {
  it('forwards the explicit key and accepts the recorded live response', async () => {
    let authorization: string | null = null;

    const gateway = createGatewayProvider({
      apiKey: 'sst-explicit-api-key',
      baseURL: 'https://gateway.test',
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization');

        return new Response(JSON.stringify(liveResponse), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      },
    });

    const result = await gateway('openai/gpt-4.1-nano').doGenerate({
      prompt,
    });

    expect(authorization).toBe('Bearer sst-explicit-api-key');
    expect(result.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'gateway-ok' }),
    ]);
    expect(result.finishReason).toBe('stop');
  });
});
