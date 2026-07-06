import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { convertToAmazonBedrockChatMessages } from '../../../../packages/amazon-bedrock/src/convert-to-amazon-bedrock-chat-messages.ts';

function assertBedrockToolResultImmediatelyFollowsToolUse(
  messages: Array<{ role: string; content: Array<Record<string, unknown>> }>,
) {
  const assistantToolUseIndex = messages.findIndex(
    message =>
      message.role === 'assistant' &&
      message.content.some(part => 'toolUse' in part),
  );

  if (assistantToolUseIndex === -1) {
    throw new Error('Expected the converted Bedrock payload to contain toolUse.');
  }

  const nextMessage = messages[assistantToolUseIndex + 1];

  if (
    nextMessage?.role !== 'user' ||
    !nextMessage.content.some(part => 'toolResult' in part)
  ) {
    throw new Error(
      [
        'Reproduced issue #11216: the Amazon Bedrock payload contains a toolUse',
        'but the immediately following message is not a user message containing',
        'the matching toolResult. Bedrock rejects this shape with:',
        '`tool_use` ids were found without `tool_result` blocks immediately after.',
      ].join(' '),
    );
  }
}

async function main() {
  const prompt: LanguageModelV4Prompt = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'User prompt here' }],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'tooluse_XzLWc3v7S6S0mO3vpBh39Q',
          toolName: 'toolCall',
          input: { query: 'toolCallInput' },
        },
        {
          type: 'tool-result',
          toolCallId: 'tooluse_XzLWc3v7S6S0mO3vpBh39Q',
          toolName: 'toolCall',
          output: { type: 'json', value: { success: true } },
        },
      ],
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'assistant response' }],
    },
  ];

  const converted = await convertToAmazonBedrockChatMessages(prompt);

  console.log(JSON.stringify(converted, null, 2));
  assertBedrockToolResultImmediatelyFollowsToolUse(converted.messages);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
