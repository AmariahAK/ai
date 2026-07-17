import assert from 'node:assert/strict';
import { DefaultChatTransport, type UIMessage } from 'ai';

const encoder = new TextEncoder();

async function parseServerChunk(chunk: unknown) {
  const transport = new DefaultChatTransport<UIMessage>({
    api: 'https://example.test/api/chat',
    fetch: async () =>
      new Response(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`), {
        headers: { 'content-type': 'text/event-stream' },
      }),
  });

  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'reproduction',
    messageId: undefined,
    messages: [],
    abortSignal: undefined,
  });

  return (await stream.getReader().read()).value;
}

async function main() {
  const baselineChunk = {
    type: 'tool-output-available',
    toolCallId: 'call-1',
    output: { temperature: 72 },
  };

  assert.deepEqual(await parseServerChunk(baselineChunk), baselineChunk);

  const currentMetadataChunk = {
    ...baselineChunk,
    providerMetadata: { openai: { itemId: 'item-1' } },
    toolMetadata: { clientName: 'ai-sdk-mcp-client' },
  };

  assert.deepEqual(
    await parseServerChunk(currentMetadataChunk),
    currentMetadataChunk,
  );

  const newerServerChunk = {
    ...baselineChunk,
    optionalFieldFromNewerServer: true,
  };

  try {
    await parseServerChunk(newerServerChunk);
  } catch (error) {
    assert.ok(
      error instanceof Error &&
        error.name === 'AI_TypeValidationError' &&
        error.message.includes('"code": "unrecognized_keys"') &&
        error.message.includes('optionalFieldFromNewerServer'),
      'Expected strict UI message chunk validation to reject the newer field',
    );

    throw new Error(
      'Forward compatibility failure: DefaultChatTransport rejected optionalFieldFromNewerServer with AI_TypeValidationError.',
    );
  }
}

main();
