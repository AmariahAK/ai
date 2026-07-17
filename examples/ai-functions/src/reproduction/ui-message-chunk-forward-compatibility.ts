import { DefaultChatTransport, type UIMessage } from 'ai';

async function parseChunk(chunk: unknown) {
  const transport = new DefaultChatTransport<UIMessage>({
    fetch: async () =>
      new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  });

  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'reproduction',
    messageId: undefined,
    messages: [],
    abortSignal: undefined,
  });
  const result = await stream.getReader().read();

  if (result.done) {
    throw new Error('Expected one UI message chunk, but the stream was empty.');
  }

  return result.value;
}

async function isRejectedAsUnknownKey(chunk: unknown, fieldName: string) {
  try {
    await parseChunk(chunk);
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      error instanceof Error &&
      error.name === 'AI_TypeValidationError' &&
      message.includes(fieldName) &&
      message.includes('unrecognized_keys')
    ) {
      return true;
    }

    throw error;
  }
}

async function main() {
  const baselineToolOutputChunk = {
    type: 'tool-output-available',
    toolCallId: 'tool-call-1',
    output: { weather: 'sunny' },
  };
  const baselineToolOutputResult = await parseChunk(baselineToolOutputChunk);

  if (
    baselineToolOutputResult.type !== 'tool-output-available' ||
    baselineToolOutputResult.toolCallId !== baselineToolOutputChunk.toolCallId
  ) {
    throw new Error('The baseline tool-output-available chunk did not parse.');
  }

  const baselineToolInputChunk = {
    type: 'tool-input-available',
    toolCallId: 'tool-call-2',
    toolName: 'describe_entity',
    input: { entity: 'weather' },
    dynamic: true,
  };
  const baselineToolInputResult = await parseChunk(baselineToolInputChunk);

  if (
    baselineToolInputResult.type !== 'tool-input-available' ||
    baselineToolInputResult.toolCallId !== baselineToolInputChunk.toolCallId
  ) {
    throw new Error('The baseline tool-input-available chunk did not parse.');
  }

  const providerMetadataChunk = {
    ...baselineToolOutputChunk,
    providerMetadata: {
      openai: {
        itemId: 'item-1',
      },
    },
  };
  const toolMetadataChunk = {
    ...baselineToolInputChunk,
    toolMetadata: {
      clientName: 'ai-sdk-mcp-client',
    },
    title: 'Describe entity',
  };
  const rejectedFields: string[] = [];

  if (await isRejectedAsUnknownKey(providerMetadataChunk, 'providerMetadata')) {
    rejectedFields.push('providerMetadata');
  }

  if (await isRejectedAsUnknownKey(toolMetadataChunk, 'toolMetadata')) {
    rejectedFields.push('toolMetadata');
  }

  if (rejectedFields.length > 0) {
    throw new Error(
      `FORWARD_COMPATIBILITY_BUG: DefaultChatTransport rejected newer server fields on known chunk types: ${rejectedFields.join(', ')}.`,
    );
  }

  console.log(
    'DefaultChatTransport accepted newer server fields on known chunk types.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
