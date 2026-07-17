import assert from 'node:assert/strict';
import { convertToModelMessages } from '../../../../packages/ai/dist/index.mjs';
import type { UIMessage } from '../../../../packages/ai/src/index';

async function main() {
  const incompleteAssistantMessage: UIMessage = {
    id: 'assistant-incomplete',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-clientTool',
        toolCallId: 'call-1',
        state: 'input-available',
        input: {},
      },
    ],
  };

  const followingUserMessage: UIMessage = {
    id: 'user-follow-up',
    role: 'user',
    parts: [{ type: 'text', text: 'Continue' }],
  };

  let converted;
  try {
    converted = convertToModelMessages([
      incompleteAssistantMessage,
      followingUserMessage,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Unsupported tool part state: input-available')) {
      throw new Error(
        `ISSUE #7258 REPRODUCED: ${message}`,
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    throw error;
  }

  assert.deepEqual(converted, [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'clientTool',
          input: {},
          providerExecuted: undefined,
        },
      ],
    },
    { role: 'tool', content: [] },
    {
      role: 'user',
      content: [{ type: 'text', text: 'Continue' }],
    },
  ]);

  const completed = convertToModelMessages([
    {
      ...incompleteAssistantMessage,
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-clientTool',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
          output: 'success',
        },
      ],
    },
    followingUserMessage,
  ]);

  assert.deepEqual(completed[1], {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'clientTool',
        output: { type: 'text', value: 'success' },
      },
    ],
  });

  const ignored = convertToModelMessages(
    [incompleteAssistantMessage, followingUserMessage],
    { ignoreIncompleteToolCalls: true },
  );

  assert.deepEqual(ignored, [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Continue' }],
    },
  ]);

  console.log(
    'Issue #7258 not reproduced: input-available converted without throwing; output-available produced a tool result; ignoreIncompleteToolCalls filtered the incomplete call.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
