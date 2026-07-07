import { readUIMessageStream, type UIMessageChunk } from 'ai';

function createStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function main() {
  const stream = createStream([
    {
      type: 'start',
      messageId: 'msg-12670',
    },
    {
      type: 'file',
      mediaType: 'image/png',
      url: 'data:image/png;base64,iVBORw0KGgo=',
      providerMetadata: {
        customProvider: {
          fileId: 'file-12670',
        },
      },
    },
    {
      type: 'finish',
    },
  ]);

  let finalMessage;
  for await (const message of readUIMessageStream({ stream })) {
    finalMessage = message;
  }

  const filePart = finalMessage?.parts.find(part => part.type === 'file');
  const fileId = filePart?.providerMetadata?.customProvider?.fileId;
  const providerMetadataPreserved = fileId === 'file-12670';

  console.log(
    JSON.stringify(
      {
        providerMetadataPreserved,
        fileId,
        filePart,
      },
      null,
      2,
    ),
  );

  if (!providerMetadataPreserved) {
    throw new Error(
      'Expected processUIMessageStream to preserve providerMetadata on file parts.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
