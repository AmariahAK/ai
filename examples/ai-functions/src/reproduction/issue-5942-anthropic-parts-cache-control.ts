import {
  createAnthropic,
  type AnthropicLanguageModelOptions,
} from '@ai-sdk/anthropic';
import { APICallError, streamText } from 'ai';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

const fixtureDirectory = new URL(
  '../../../../packages/anthropic/src/__fixtures__/',
  import.meta.url,
);

const cacheableText = [
  'This is stable reference material used to verify Anthropic prompt caching.',
  'Keep it unchanged between requests.',
  `Reproduction run: ${randomUUID()}.`,
  ...Array.from(
    { length: 1_000 },
    (_, index) =>
      `Reference item ${index}: structured messages must preserve message-level provider options.`,
  ),
  'Reply with only OK.',
].join('\n');

type CapturedCall = {
  requestBody: unknown;
  responseText: Promise<string>;
};

function toChunksFixture(responseText: string): string {
  return responseText
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice('data: '.length))
    .filter(line => line !== '[DONE]')
    .join('\n');
}

async function main() {
  const calls: CapturedCall[] = [];
  const anthropic = createAnthropic({
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      calls.push({
        requestBody:
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        responseText: response.clone().text(),
      });
      return response;
    },
  });

  async function runCacheRequest() {
    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      maxOutputTokens: 8,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: cacheableText }],
          providerOptions: {
            anthropic: {
              cacheControl: { type: 'ephemeral' },
            } satisfies AnthropicLanguageModelOptions,
          },
        },
      ],
    });

    await result.text;

    return {
      request: await result.request,
      usage: await result.usage,
      providerMetadata: (await result.providerMetadata)?.anthropic,
    };
  }

  const first = await runCacheRequest();
  const second = await runCacheRequest();

  await fs.writeFile(
    new URL('anthropic-issue-5942-cache-write.chunks.txt', fixtureDirectory),
    `${toChunksFixture(await calls[0].responseText)}\n`,
  );
  await fs.writeFile(
    new URL('anthropic-issue-5942-cache-read.chunks.txt', fixtureDirectory),
    `${toChunksFixture(await calls[1].responseText)}\n`,
  );

  let exactModelError: { statusCode?: number; message: string } | undefined;
  try {
    const exactModelResult = streamText({
      model: anthropic('claude-3-7-sonnet-20250219'),
      maxOutputTokens: 8,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: cacheableText }],
          providerOptions: {
            anthropic: {
              cacheControl: { type: 'ephemeral' },
            } satisfies AnthropicLanguageModelOptions,
          },
        },
      ],
      onError({ error }) {
        exactModelError = APICallError.isInstance(error)
          ? { statusCode: error.statusCode, message: error.message }
          : {
              message: error instanceof Error ? error.message : String(error),
            };
      },
    });
    await exactModelResult.text;
  } catch (error) {
    exactModelError ??= {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const requestBody = calls[0].requestBody as {
    messages?: Array<{
      content?: Array<{ cache_control?: { type?: string } }>;
    }>;
  };
  const forwardedCacheControl =
    requestBody.messages?.[0]?.content?.at(-1)?.cache_control;
  const cacheCreationInputTokens =
    first.usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const cacheReadInputTokens =
    second.usage.inputTokenDetails.cacheReadTokens ?? 0;

  console.log(
    JSON.stringify(
      {
        forwardedCacheControl,
        firstUsage: first.usage,
        secondUsage: second.usage,
        firstProviderMetadata: first.providerMetadata,
        secondProviderMetadata: second.providerMetadata,
        firstRequestBodyHasCacheControl: JSON.stringify(
          first.request.body,
        ).includes('"cache_control"'),
        exactModelError,
      },
      null,
      2,
    ),
  );

  if (forwardedCacheControl?.type !== 'ephemeral') {
    throw new Error(
      'Reproduced issue #5942: message-level cacheControl was not forwarded for structured content.',
    );
  }

  if (cacheCreationInputTokens === 0) {
    throw new Error(
      'Reproduced issue #5942: Anthropic did not create a cache entry for structured content.',
    );
  }

  if (cacheReadInputTokens === 0) {
    throw new Error(
      'Reproduced issue #5942: Anthropic did not read the cache entry on the repeated request.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
