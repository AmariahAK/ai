import { smoothStream, type TextStreamPart } from 'ai';
import type { ToolSet } from '@ai-sdk/provider-utils';

const providerMetadata = {
  anthropic: { signature: 'sig_issue_14373' },
};

async function collectStream(stream: ReadableStream<TextStreamPart<ToolSet>>) {
  const parts: TextStreamPart<ToolSet>[] = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      return parts;
    }

    parts.push(value);
  }
}

async function main() {
  const input = new ReadableStream<TextStreamPart<ToolSet>>({
    start(controller) {
      controller.enqueue({ type: 'reasoning-start', id: '1' });
      controller.enqueue({
        text: 'First second final',
        type: 'reasoning-delta',
        id: '1',
        providerMetadata,
      });
      controller.enqueue({ type: 'reasoning-end', id: '1' });
      controller.close();
    },
  });

  const parts = await collectStream(
    input.pipeThrough(
      smoothStream({
        chunking: 'word',
        delayInMs: null,
      })({ tools: {} }),
    ),
  );

  console.log(JSON.stringify(parts, null, 2));

  const missingProviderMetadata = parts
    .filter(part => part.type === 'reasoning-delta')
    .filter(part => part.providerMetadata == null)
    .map(part => part.text);

  if (missingProviderMetadata.length > 0) {
    throw new Error(
      `smoothStream dropped providerMetadata on chunked reasoning-delta text: ${JSON.stringify(missingProviderMetadata)}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
