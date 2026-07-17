import assert from 'node:assert/strict';
import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai';

type ClientTools = {
  clientTool: {
    input: { destination: string };
    output: string;
  };
};

type ClientUIMessage = UIMessage<unknown, never, ClientTools>;

function hasToolCall(messages: ModelMessage[], toolCallId: string): boolean {
  return messages.some(
    message =>
      message.role === 'assistant' &&
      Array.isArray(message.content) &&
      message.content.some(
        part => part.type === 'tool-call' && part.toolCallId === toolCallId,
      ),
  );
}

function hasToolResult(messages: ModelMessage[], toolCallId: string): boolean {
  return messages.some(
    message =>
      message.role === 'tool' &&
      message.content.some(
        part => part.type === 'tool-result' && part.toolCallId === toolCallId,
      ),
  );
}

async function main() {
  const initialMessages: ClientUIMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Open the documentation.' }],
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-clientTool',
          state: 'input-available',
          toolCallId: 'call-incomplete',
          input: { destination: '/docs' },
        },
      ],
    },
  ];

  // This represents sending another message with an input-available client
  // tool call already present in useChat's initial/current messages.
  const messagesAfterSend: ClientUIMessage[] = [
    ...initialMessages,
    {
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'What did you open?' }],
    },
  ];

  const convertedIncomplete = await convertToModelMessages(messagesAfterSend);

  assert.equal(
    hasToolCall(convertedIncomplete, 'call-incomplete'),
    true,
    'input-available tool call should convert without throwing',
  );
  assert.deepEqual(convertedIncomplete.at(-1), {
    role: 'user',
    content: [{ type: 'text', text: 'What did you open?' }],
  });

  const convertedIgnored = await convertToModelMessages(messagesAfterSend, {
    ignoreIncompleteToolCalls: true,
  });

  assert.equal(
    hasToolCall(convertedIgnored, 'call-incomplete'),
    false,
    'ignoreIncompleteToolCalls should filter the incomplete tool call',
  );

  const completedMessages: ClientUIMessage[] = [
    initialMessages[0],
    {
      id: 'assistant-complete',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-clientTool',
          state: 'output-available',
          toolCallId: 'call-complete',
          input: { destination: '/docs' },
          output: 'success',
        },
      ],
    },
  ];

  const convertedComplete = await convertToModelMessages(completedMessages);

  assert.equal(
    hasToolCall(convertedComplete, 'call-complete'),
    true,
    'completed client tool call should retain its tool call',
  );
  assert.equal(
    hasToolResult(convertedComplete, 'call-complete'),
    true,
    'completed client tool call should produce a tool result',
  );

  console.log(
    'Issue #7258 not reproduced: input-available converted without throwing; output-available produced a tool result; ignoreIncompleteToolCalls filtered the incomplete call.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
