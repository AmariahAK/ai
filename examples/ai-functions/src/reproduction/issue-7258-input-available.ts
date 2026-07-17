import assert from 'node:assert/strict';
import { convertToModelMessages, type UIMessage } from 'ai';

const incompleteToolHistory: UIMessage[] = [
  {
    id: 'assistant-1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-clientTool',
        toolCallId: 'call-1',
        state: 'input-available',
        input: { value: 'test' },
      },
    ],
  },
  {
    id: 'user-2',
    role: 'user',
    parts: [{ type: 'text', text: 'Continue' }],
  },
];

const completedToolHistory: UIMessage[] = [
  {
    id: 'assistant-1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-clientTool',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { value: 'test' },
        output: 'success',
      },
    ],
  },
  {
    id: 'user-2',
    role: 'user',
    parts: [{ type: 'text', text: 'Continue' }],
  },
];

async function main() {
  const convertedIncompleteHistory = await convertToModelMessages(
    incompleteToolHistory,
  );

  assert.equal(convertedIncompleteHistory.length, 2);
  assert.deepEqual(convertedIncompleteHistory[0], {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'clientTool',
        input: { value: 'test' },
        providerExecuted: undefined,
      },
    ],
  });
  assert.deepEqual(convertedIncompleteHistory[1], {
    role: 'user',
    content: [{ type: 'text', text: 'Continue' }],
  });

  const convertedCompletedHistory =
    await convertToModelMessages(completedToolHistory);

  assert.equal(convertedCompletedHistory.length, 3);
  assert.equal(convertedCompletedHistory[0].role, 'assistant');
  assert.deepEqual(convertedCompletedHistory[1], {
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
  assert.equal(convertedCompletedHistory[2].role, 'user');

  const ignoredIncompleteHistory = await convertToModelMessages(
    incompleteToolHistory,
    { ignoreIncompleteToolCalls: true },
  );

  assert.deepEqual(ignoredIncompleteHistory, [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Continue' }],
    },
  ]);

  console.log(
    'Issue #7258 not reproduced: input-available and completed client tool histories converted without an unsupported-state error.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
