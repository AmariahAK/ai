import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

type ChatCompletionResponseBody = {
  id?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      audio_tokens?: number;
    };
  };
};

type Usage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  reasoningTokens: number | undefined;
  cachedInputTokens: number | undefined;
};

const fixturePath = path.resolve(
  process.cwd(),
  '../../packages/openai/src/chat/__fixtures__/openai-chat-cached-input-tokens-11178.json',
);

const staticSystemPrompt = [
  'You are validating prompt caching token accounting for vercel/ai issue #11178.',
  'Keep every shared prefix byte identical across requests.',
  ...Array.from(
    { length: 420 },
    (_, index) =>
      `Stable cache paragraph ${index.toString().padStart(3, '0')}: ` +
      'This deterministic sentence exists only to make the prompt longer than the OpenAI prompt-cache threshold.',
  ),
].join('\n');

function getRawCachedTokens(body: ChatCompletionResponseBody): number {
  return body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
}

async function runAttempt(attempt: number) {
  const result = await generateText({
    model: openai.chat('gpt-4o-mini'),
    system: staticSystemPrompt,
    prompt: 'Reply with exactly: ok',
    temperature: 0,
    maxOutputTokens: 8,
    providerOptions: {
      openai: {
        promptCacheKey: 'vercel-ai-issue-11178-cached-input-tokens',
      },
    },
  });

  const rawResponseBody = result.response.body as ChatCompletionResponseBody;
  const rawCachedTokens = getRawCachedTokens(rawResponseBody);
  const sdkCachedInputTokens = result.usage.cachedInputTokens ?? 0;

  console.log(
    JSON.stringify(
      {
        attempt,
        responseId: rawResponseBody.id,
        rawCachedTokens,
        sdkCachedInputTokens,
        usage: result.usage,
        providerMetadata: result.providerMetadata,
      },
      null,
      2,
    ),
  );

  return {
    attempt,
    responseId: rawResponseBody.id,
    model: rawResponseBody.model,
    rawCachedTokens,
    sdkCachedInputTokens,
    sdkUsage: result.usage as Usage,
    providerMetadata: result.providerMetadata,
    rawResponseBody,
  };
}

async function main() {
  const attempts = [];

  for (let attempt = 1; attempt <= 6; attempt++) {
    attempts.push(await runAttempt(attempt));

    if (attempts.at(-1)?.rawCachedTokens) {
      break;
    }

    await setTimeout(1000);
  }

  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(
    fixturePath,
    `${JSON.stringify(
      {
        issue: '11178',
        model: 'gpt-4o-mini',
        description:
          'Recorded live OpenAI Chat Completions responses for prompt cache usage mapping.',
        attempts,
      },
      null,
      2,
    )}\n`,
  );

  const cachedAttempt = attempts.find(attempt => attempt.rawCachedTokens > 0);
  if (cachedAttempt == null) {
    throw new Error(
      `OpenAI did not report usage.prompt_tokens_details.cached_tokens > 0 after ${attempts.length} attempts; cached token mapping could not be evaluated.`,
    );
  }

  if (cachedAttempt.sdkCachedInputTokens !== cachedAttempt.rawCachedTokens) {
    throw new Error(
      `Expected SDK usage.cachedInputTokens to equal raw OpenAI cached_tokens (${cachedAttempt.rawCachedTokens}), but received ${cachedAttempt.sdkCachedInputTokens}.`,
    );
  }

  console.log(
    `Mapped cached tokens successfully: raw cached_tokens=${cachedAttempt.rawCachedTokens}, SDK cachedInputTokens=${cachedAttempt.sdkCachedInputTokens}.`,
  );
  console.log(`Wrote fixture: ${fixturePath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
