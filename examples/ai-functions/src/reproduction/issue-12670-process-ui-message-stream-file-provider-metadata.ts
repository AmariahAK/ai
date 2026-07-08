import assert from 'node:assert/strict';
import { readUIMessageStream, streamText } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';

const expectedProviderMetadata = {
  customProvider: { fileId: 'file-12670' },
};

async function main() {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          {
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'data', data: 'iVBORw0KGgo=' },
            providerMetadata: expectedProviderMetadata,
          },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: 1,
                text: 1,
                reasoning: undefined,
              },
            },
          },
        ],
      }),
    }),
  });

  const uiStream = streamText({
    model,
    prompt: 'give me a file',
  }).toUIMessageStream();

  let filePart:
    | Extract<
        Awaited<ReturnType<typeof readUIMessageStream>> extends AsyncIterable<
          infer MESSAGE
        >
          ? MESSAGE extends { parts: Array<infer PART> }
            ? PART
            : never
          : never,
        { type: 'file' }
      >
    | undefined;

  for await (const message of readUIMessageStream({ stream: uiStream })) {
    filePart = message.parts.find(part => part.type === 'file') ?? filePart;
  }

  const observedProviderMetadata = filePart?.providerMetadata;

  console.log(
    JSON.stringify(
      {
        providerMetadataPreserved:
          JSON.stringify(observedProviderMetadata) ===
          JSON.stringify(expectedProviderMetadata),
        observedProviderMetadata,
        expectedProviderMetadata,
        filePart,
      },
      null,
      2,
    ),
  );

  assert.deepEqual(
    observedProviderMetadata,
    expectedProviderMetadata,
    'Expected streamText().toUIMessageStream() -> readUIMessageStream() to preserve file providerMetadata',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
