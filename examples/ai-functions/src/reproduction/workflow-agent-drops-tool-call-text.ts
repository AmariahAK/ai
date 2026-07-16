import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { tool } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod/v4';
import { WorkflowAgent } from '../../../../packages/workflow/dist/index.js';

const narration = 'Found the root cause — implementing the fix now.';

const usage = {
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
};

function finish(finishReason: 'stop' | 'tool-calls') {
  return {
    type: 'finish' as const,
    finishReason: {
      unified: finishReason,
      raw: finishReason,
    },
    usage,
    providerMetadata: {},
  };
}

async function main() {
  let callCount = 0;
  let secondPrompt: LanguageModelV4Prompt | undefined;
  let firstStepContainedNarration = false;

  const model = new MockLanguageModelV4({
    doStream: async options => {
      callCount++;

      if (callCount === 1) {
        return {
          stream: convertArrayToReadableStream([
            { type: 'stream-start' as const, warnings: [] },
            { type: 'text-start' as const, id: 'text-1' },
            {
              type: 'text-delta' as const,
              id: 'text-1',
              delta: narration,
            },
            { type: 'text-end' as const, id: 'text-1' },
            {
              type: 'tool-call' as const,
              toolCallId: 'tool-call-1',
              toolName: 'applyFix',
              input: '{}',
            },
            finish('tool-calls'),
          ]),
        };
      }

      secondPrompt = options.prompt;
      return {
        stream: convertArrayToReadableStream([
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: 'text-2' },
          { type: 'text-delta' as const, id: 'text-2', delta: 'Done.' },
          { type: 'text-end' as const, id: 'text-2' },
          finish('stop'),
        ]),
      };
    },
  });

  const agent = new WorkflowAgent({
    model,
    tools: {
      applyFix: tool({
        inputSchema: z.object({}),
        execute: async () => 'fixed',
      }),
    },
    onStepEnd: step => {
      if (step.stepNumber === 0) {
        firstStepContainedNarration = step.content.some(
          part => part.type === 'text' && part.text === narration,
        );
      }
    },
  });

  await agent.stream({
    messages: [{ role: 'user', content: 'Find and fix the bug.' }],
  });

  if (!firstStepContainedNarration) {
    throw new Error(
      'Reproduction harness failed: the first WorkflowAgent step did not record the emitted narration.',
    );
  }

  if (secondPrompt == null) {
    throw new Error(
      'Reproduction harness failed: WorkflowAgent did not start a second model step.',
    );
  }

  const assistantToolCallMessage = secondPrompt.find(
    message =>
      message.role === 'assistant' &&
      Array.isArray(message.content) &&
      message.content.some(
        part => part.type === 'tool-call' && part.toolCallId === 'tool-call-1',
      ),
  );

  const narrationWasReplayed =
    assistantToolCallMessage != null &&
    Array.isArray(assistantToolCallMessage.content) &&
    assistantToolCallMessage.content.some(
      part => part.type === 'text' && part.text === narration,
    );

  if (!narrationWasReplayed) {
    console.error(
      'ISSUE #17123 REPRODUCED: WorkflowAgent omitted assistant text from the next model prompt after a tool-calls step.',
    );
    console.error(
      `Emitted text: ${JSON.stringify(narration)}\nAssistant replay: ${JSON.stringify(assistantToolCallMessage)}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    'Issue #17123 was not reproduced: WorkflowAgent retained the assistant text.',
  );
}

await main();
