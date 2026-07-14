import {
  createGoogleGenerativeAI,
  type GoogleLanguageModelOptions,
} from '@ai-sdk/google';
import { streamText } from 'ai';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const modelId = 'gemini-3-pro-image-preview';
const rawResponses: Array<Promise<string>> = [];

const recordingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);

  if (process.env.RECORD_FIXTURE === '1') {
    rawResponses.push(response.clone().text());
  }

  return response;
};

const google = createGoogleGenerativeAI({ fetch: recordingFetch });

const providerOptions = {
  google: {
    responseModalities: ['TEXT', 'IMAGE'],
  } satisfies GoogleLanguageModelOptions,
};

function getImageFiles(
  parts: ReadonlyArray<{
    type: string;
    file?: { mediaType: string };
    providerMetadata?: {
      google?: {
        thought?: boolean;
        thoughtSignature?: unknown;
      };
    };
  }>,
) {
  return parts.filter(
    part =>
      part.type === 'file' &&
      part.file?.mediaType.startsWith('image/') &&
      part.providerMetadata?.google?.thought !== true,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function collectStream<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const parts: T[] = [];
  for await (const part of stream) {
    parts.push(part);
  }
  return parts;
}

async function recordFirstTurnFixture() {
  if (process.env.RECORD_FIXTURE !== '1') {
    return;
  }

  const firstResponse = await rawResponses[0];
  assert(
    firstResponse != null,
    'The first raw provider response was not recorded.',
  );

  const fixture = firstResponse
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice('data: '.length))
    .map(line =>
      line.replace(
        /("data"\s*:\s*")[^"]*(")/g,
        '$1recorded-image-data-omitted$2',
      ),
    )
    .join('\n');

  const fixturePath = fileURLToPath(
    new URL(
      '../../../../packages/google/src/__fixtures__/issue-10660-image-thought-signature.chunks.txt',
      import.meta.url,
    ),
  );
  await writeFile(fixturePath, `${fixture}\n`);
  console.log(`Recorded sanitized first-turn fixture at ${fixturePath}`);
}

async function main() {
  const firstTurn = streamText({
    model: google(modelId),
    prompt:
      'Create a simple square illustration of the moon in a dark night sky.',
    providerOptions,
  });

  const firstTurnParts = await collectStream(firstTurn.fullStream);
  const firstTurnImages = getImageFiles(firstTurnParts);
  assert(
    firstTurnImages.length > 0,
    'The first streaming request did not produce an output image.',
  );
  assert(
    firstTurnImages.every(
      part =>
        typeof part.providerMetadata?.google?.thoughtSignature === 'string',
    ),
    'At least one streamed output image was missing providerMetadata.google.thoughtSignature.',
  );

  const firstTurnResponse = await firstTurn.response;
  const assistantMessage = firstTurnResponse.messages.find(
    message => message.role === 'assistant',
  );
  assert(
    Array.isArray(assistantMessage?.content) &&
      assistantMessage.content.some(
        part =>
          part.type === 'file' &&
          typeof part.providerOptions?.google?.thoughtSignature === 'string',
      ),
    'The response history did not preserve the image thought signature.',
  );

  const secondTurn = streamText({
    model: google(modelId),
    messages: [
      ...firstTurnResponse.messages,
      {
        role: 'user',
        content:
          'Refine the previous image so the moon is made entirely of yellow cheese. Return the revised image.',
      },
    ],
    providerOptions,
  });

  const secondTurnParts = await collectStream(secondTurn.fullStream);
  const secondTurnImages = getImageFiles(secondTurnParts);
  assert(
    secondTurnImages.length > 0,
    'The follow-up streaming request did not produce a refined output image.',
  );

  await recordFirstTurnFixture();

  console.log(
    JSON.stringify(
      {
        modelId,
        firstTurnOutputImages: firstTurnImages.length,
        firstTurnSignedOutputImages: firstTurnImages.filter(
          part =>
            typeof part.providerMetadata?.google?.thoughtSignature === 'string',
        ).length,
        responseHistoryPreservedImageThoughtSignature: true,
        secondTurnOutputImages: secondTurnImages.length,
        secondTurnSucceeded: true,
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
