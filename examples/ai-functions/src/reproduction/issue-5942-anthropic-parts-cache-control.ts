import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, type ModelMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const modelId = 'claude-sonnet-4-6';
const exactReportedModelId = 'claude-3-7-sonnet-20250219';
const fixtureDirectory = path.resolve(
  process.cwd(),
  '../../packages/anthropic/src/__fixtures__',
);

const longText = Array.from(
  { length: 600 },
  (_, index) =>
    `Cacheable reference paragraph ${index}: provider options on structured message content must reach Anthropic without being dropped. Keep this paragraph unchanged between requests.`,
).join('\n');
const runId = randomUUID();

const messages: ModelMessage[] = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `${longText}\n\nReproduction run: ${runId}\nReturn only the word OK.`,
      },
    ],
    providerOptions: {
      anthropic: {
        cacheControl: {
          type: 'ephemeral',
        },
      },
    },
  },
];

type CallObservation = {
  cacheControl: unknown;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  fixturePath?: string;
  modelId: string;
};

function extractNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function extractCacheControl(requestBody: unknown): unknown {
  if (
    requestBody == null ||
    typeof requestBody !== 'object' ||
    !('messages' in requestBody) ||
    !Array.isArray(requestBody.messages)
  ) {
    return undefined;
  }

  const firstMessage = requestBody.messages[0];
  if (
    firstMessage == null ||
    typeof firstMessage !== 'object' ||
    !('content' in firstMessage) ||
    !Array.isArray(firstMessage.content)
  ) {
    return undefined;
  }

  const lastPart = firstMessage.content.at(-1);
  return lastPart != null &&
    typeof lastPart === 'object' &&
    'cache_control' in lastPart
    ? lastPart.cache_control
    : undefined;
}

async function writeChunksFixture({
  fixtureName,
  responseText,
}: {
  fixtureName: string;
  responseText: string;
}): Promise<string> {
  const fixturePath = path.join(fixtureDirectory, `${fixtureName}.chunks.txt`);
  const fixtureLines = responseText
    .split(/\r?\n/)
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice('data: '.length))
    .filter(line => line.length > 0 && line !== '[DONE]');

  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(fixturePath, `${fixtureLines.join('\n')}\n`);

  return fixturePath;
}

async function callAnthropic({
  fixtureName,
  model,
}: {
  fixtureName?: string;
  model: string;
}): Promise<CallObservation> {
  let responseTextPromise: Promise<string> | undefined;

  const anthropic = createAnthropic({
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      responseTextPromise = response.clone().text();
      return response;
    },
  });

  const result = streamText({
    model: anthropic(model),
    messages,
    maxOutputTokens: 1,
  });

  await result.text;

  const request = await result.request;
  const requestBody =
    typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
  const providerMetadata = await result.providerMetadata;
  const usage = await result.usage;
  const anthropicMetadata = providerMetadata?.anthropic as
    | Record<string, unknown>
    | undefined;
  const rawUsage = anthropicMetadata?.usage as
    | Record<string, unknown>
    | undefined;

  let fixturePath: string | undefined;
  if (fixtureName != null && responseTextPromise != null) {
    fixturePath = await writeChunksFixture({
      fixtureName,
      responseText: await responseTextPromise,
    });
  }

  return {
    cacheControl: extractCacheControl(requestBody),
    cacheCreationInputTokens: extractNumber(
      anthropicMetadata?.cacheCreationInputTokens ??
        rawUsage?.cache_creation_input_tokens,
    ),
    cacheReadInputTokens: extractNumber(
      usage.cachedInputTokens ?? rawUsage?.cache_read_input_tokens,
    ),
    fixturePath,
    modelId: model,
  };
}

async function checkExactReportedModel(): Promise<
  | { modelId: string; result: 'available' }
  | { error: { message: string; statusCode?: number }; modelId: string }
> {
  try {
    const result = await createAnthropic()(exactReportedModelId).doStream({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${longText}\n\nReproduction run: ${runId}\nReturn only the word OK.`,
            },
          ],
          providerOptions: {
            anthropic: {
              cacheControl: {
                type: 'ephemeral',
              },
            },
          },
        },
      ],
      maxOutputTokens: 1,
    });

    await result.stream.pipeTo(new WritableStream());

    return {
      modelId: exactReportedModelId,
      result: 'available',
    };
  } catch (error) {
    return {
      error: getErrorDetails(error),
      modelId: exactReportedModelId,
    };
  }
}

function getErrorDetails(error: unknown): {
  message: string;
  statusCode?: number;
} {
  if (error == null || typeof error !== 'object') {
    return { message: String(error) };
  }

  return {
    message:
      'message' in error && typeof error.message === 'string'
        ? error.message
        : String(error),
    statusCode:
      'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined,
  };
}

async function main(): Promise<void> {
  const first = await callAnthropic({
    fixtureName: 'anthropic-issue-5942-cache-write',
    model: modelId,
  });
  const second = await callAnthropic({
    fixtureName: 'anthropic-issue-5942-cache-read',
    model: modelId,
  });

  if (
    JSON.stringify(first.cacheControl) !==
      JSON.stringify({ type: 'ephemeral' }) ||
    JSON.stringify(second.cacheControl) !==
      JSON.stringify({ type: 'ephemeral' })
  ) {
    throw new Error(
      `Issue #5942 reproduced: cache_control was not forwarded for structured message content: ${JSON.stringify(
        { first: first.cacheControl, second: second.cacheControl },
      )}`,
    );
  }

  if (first.cacheCreationInputTokens <= 0) {
    throw new Error(
      `Issue #5942 reproduced: the first request created ${first.cacheCreationInputTokens} cached tokens.`,
    );
  }

  if (second.cacheReadInputTokens <= 0) {
    throw new Error(
      `Issue #5942 reproduced: the repeated request read ${second.cacheReadInputTokens} cached tokens.`,
    );
  }

  const exactModel = await checkExactReportedModel();

  console.log(
    JSON.stringify(
      {
        exactModel,
        first,
        second,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
