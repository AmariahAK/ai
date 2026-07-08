import { readUIMessageStream, simulateReadableStream, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

const expectedProviderMetadata = {
  customProvider: { fileId: 'file-12670' },
};

async function main() {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          {
            type: 'file',
            mediaType: 'image/png',
            data: 'iVBORw0KGgo=',
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

  let filePart;

  for await (const message of readUIMessageStream({ stream: uiStream })) {
    filePart = message.parts.find(part => part.type === 'file');
  }

  const actualFileId = filePart?.providerMetadata?.customProvider?.fileId;
  const providerMetadataPreserved = actualFileId === 'file-12670';

  console.log(
    JSON.stringify(
      {
        providerMetadataPreserved,
        filePart,
        expectedProviderMetadata,
      },
      null,
      2,
    ),
  );

  if (!providerMetadataPreserved) {
    throw new Error(
      `Expected file providerMetadata.customProvider.fileId to be preserved, got ${JSON.stringify(
        filePart?.providerMetadata,
      )}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
