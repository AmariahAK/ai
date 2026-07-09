export async function processTextStream({
  stream,
  onTextPart,
}: {
  stream: ReadableStream<Uint8Array>;
  onTextPart: (chunk: string) => Promise<void> | void;
}): Promise<void> {
  const reader = stream.pipeThrough(createTextDecoderStream()).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    await onTextPart(value);
  }
}

export function createTextDecoderStream(): TransformStream<
  AllowSharedBufferSource,
  string
> {
  const decoder = new TextDecoder();

  return new TransformStream<AllowSharedBufferSource, string>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      if (text.length > 0) {
        controller.enqueue(text);
      }
    },
    flush(controller) {
      const text = decoder.decode();
      if (text.length > 0) {
        controller.enqueue(text);
      }
    },
  });
}
