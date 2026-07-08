import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { safeParseJSON } from '@ai-sdk/provider-utils';
import { streamText } from 'ai';

const expectedBase64 = 'SGVsbG8gV29ybGQ=';

const usage: LanguageModelV4Usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 1,
    text: undefined,
    reasoning: undefined,
  },
};

function convertArrayToReadableStream<T>(values: T[]): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      for (const value of values) {
        controller.enqueue(value);
      }

      controller.close();
    },
  });
}

function getFileRecord(part: unknown): Record<string, unknown> {
  if (
    typeof part !== 'object' ||
    part == null ||
    !('type' in part) ||
    part.type !== 'file' ||
    !('file' in part) ||
    typeof part.file !== 'object' ||
    part.file == null
  ) {
    throw new Error(`Expected a serialized file part, got ${String(part)}`);
  }

  return part.file as Record<string, unknown>;
}

async function main() {
  const model: LanguageModelV4 = {
    specificationVersion: 'v4',
    provider: 'issue-8332-reproduction',
    modelId: 'mock-file-stream',
    supportedUrls: {},
    async doGenerate() {
      throw new Error('doGenerate should not be called in this reproduction.');
    },
    async doStream() {
      return {
        stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
          { type: 'stream-start', warnings: [] },
          {
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'data', data: expectedBase64 },
          },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage,
          },
        ]),
      };
    },
  };

  const result = streamText({
    model,
    prompt: 'Return a generated image file.',
  });

  for await (const part of result.fullStream) {
    if (part.type !== 'file') {
      continue;
    }

    console.log('In-process file keys:', Object.keys(part.file));
    console.log('In-process file.base64:', part.file.base64);

    const serialized = JSON.stringify(part);
    const parsed = await safeParseJSON({ text: serialized });

    if (!parsed.success) {
      throw parsed.error;
    }

    const transportedFile = getFileRecord(parsed.value);

    console.log('Serialized fullStream file part:', serialized);
    console.log('Transported file keys:', Object.keys(transportedFile));
    console.log('Transported file.base64:', transportedFile.base64);
    console.log('Transported file.base64Data:', transportedFile.base64Data);

    if (transportedFile.base64 !== expectedBase64) {
      throw new Error(
        `Issue #8332 reproduced: after serializing a fullStream file part, file.base64 is ${String(
          transportedFile.base64,
        )} while file.base64Data is ${String(transportedFile.base64Data)}.`,
      );
    }
  }
}

await main();
