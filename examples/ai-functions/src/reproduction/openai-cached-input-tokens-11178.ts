import {
  createOpenAI,
  type OpenAILanguageModelChatOptions,
} from '@ai-sdk/openai';
import { generateText } from 'ai';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

type CapturedResponse = {
  url: string;
  status: number;
  body: unknown;
};

const fixturePath =
  '../../packages/openai/src/chat/__fixtures__/openai-chat-cached-input-tokens-11178.json';

const cacheKey = `ai-sdk-issue-11178-${Date.now()}`;

const longSystemPrompt = [
  'You are a deterministic cache-mapping probe.',
  'The following stable prefix is intentionally long so OpenAI prompt caching can apply.',
  ...Array.from(
    { length: 180 },
    (_, index) =>
      `Stable cache prefix sentence ${index}: maple river quartz lantern verifies cached prompt accounting.`,
  ),
].join('\n');

function getRawCachedTokens(response: unknown): number | undefined {
  if (response == null || typeof response !== 'object') {
    return undefined;
  }

  const usage = 'usage' in response ? response.usage : undefined;
  if (usage == null || typeof usage !== 'object') {
    return undefined;
  }

  const promptTokensDetails =
    'prompt_tokens_details' in usage ? usage.prompt_tokens_details : undefined;
  if (promptTokensDetails == null || typeof promptTokensDetails !== 'object') {
    return undefined;
  }

  const cachedTokens =
    'cached_tokens' in promptTokensDetails
      ? promptTokensDetails.cached_tokens
      : undefined;

  return typeof cachedTokens === 'number' ? cachedTokens : undefined;
}

async function main() {
  const capturedResponses: CapturedResponse[] = [];

  const openai = createOpenAI({
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes('/chat/completions')) {
        const responseClone = response.clone();
        let body: unknown;
        try {
          body = await responseClone.json();
        } catch {
          body = await responseClone.text();
        }

        capturedResponses.push({
          url,
          status: response.status,
          body,
        });
      }

      return response;
    },
  });

  async function createCompletion(label: string) {
    const result = await generateText({
      model: openai.chat('gpt-4o-mini'),
      system: longSystemPrompt,
      prompt: 'Reply with exactly: OK',
      temperature: 0,
      maxOutputTokens: 1,
      providerOptions: {
        openai: {
          promptCacheKey: cacheKey,
        } satisfies OpenAILanguageModelChatOptions,
      },
    });

    console.log(
      JSON.stringify(
        {
          label,
          text: result.text,
          usage: result.usage,
          sdkCacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens,
        },
        null,
        2,
      ),
    );

    return result;
  }

  await createCompletion('cache-warmup');
  await setTimeout(1000);
  const second = await createCompletion('cache-read');
  const secondRawCachedTokens = getRawCachedTokens(capturedResponses[1]?.body);

  await mkdir('../../packages/openai/src/chat/__fixtures__', {
    recursive: true,
  });
  await writeFile(
    fixturePath,
    `${JSON.stringify(
      {
        issue: 11178,
        model: 'gpt-4o-mini',
        api: 'chat.completions',
        promptCacheKey: cacheKey,
        capturedResponses,
        observedSdkUsage: second.usage,
        observedRawCachedTokens: secondRawCachedTokens,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote fixture to ${fixturePath}`);

  const rawCachedTokens = secondRawCachedTokens ?? 0;
  const sdkCacheReadTokens =
    second.usage.inputTokenDetails.cacheReadTokens ?? 0;

  if (rawCachedTokens <= 0) {
    throw new Error(
      `OpenAI did not report a cache hit on the second request; raw cached_tokens=${rawCachedTokens}`,
    );
  }

  if (sdkCacheReadTokens !== rawCachedTokens) {
    throw new Error(
      `cached token mapping mismatch: raw prompt_tokens_details.cached_tokens=${rawCachedTokens}, SDK usage.inputTokenDetails.cacheReadTokens=${sdkCacheReadTokens}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
