import { tool, type ModelMessage } from 'ai';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { expect, it } from 'vitest';
import { z } from 'zod/v4';
import { WorkflowAgent } from './workflow-agent.js';

const narration = 'Found the root cause — implementing the fix now.';

const usage = {
  inputTokens: {
    total: 3,
    noCache: 3,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 10,
    text: 10,
    reasoning: undefined,
  },
};

it('preserves assistant text in the next prompt after a tool-calls finish', async () => {
  let callCount = 0;
  let secondStepMessages: ModelMessage[] | undefined;

  const model = new MockLanguageModelV4({
    doStream: async () => {
      if (callCount++ === 0) {
        return {
          stream: convertArrayToReadableStream([
            { type: 'stream-start' as const, warnings: [] },
            {
              type: 'response-metadata' as const,
              id: 'response-1',
              modelId: 'mock-model',
              timestamp: new Date(0),
            },
            { type: 'text-start' as const, id: 'text-1' },
            {
              type: 'text-delta' as const,
              id: 'text-1',
              delta: narration,
            },
            { type: 'text-end' as const, id: 'text-1' },
            {
              type: 'tool-call' as const,
              toolCallId: 'call-1',
              toolName: 'applyFix',
              input: '{}',
            },
            {
              type: 'finish' as const,
              finishReason: {
                unified: 'tool-calls' as const,
                raw: 'tool_calls',
              },
              usage,
            },
          ]),
        };
      }

      return {
        stream: convertArrayToReadableStream([
          { type: 'stream-start' as const, warnings: [] },
          {
            type: 'response-metadata' as const,
            id: 'response-2',
            modelId: 'mock-model',
            timestamp: new Date(0),
          },
          { type: 'text-start' as const, id: 'text-2' },
          {
            type: 'text-delta' as const,
            id: 'text-2',
            delta: 'Done.',
          },
          { type: 'text-end' as const, id: 'text-2' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage,
          },
        ]),
      };
    },
  });

  const agent = new WorkflowAgent({
    model,
    tools: {
      applyFix: tool({
        description: 'Apply the selected fix.',
        inputSchema: z.object({}),
        execute: async () => ({ applied: true }),
      }),
    },
    prepareStep: ({ stepNumber, messages }) => {
      if (stepNumber === 1) {
        secondStepMessages = messages as ModelMessage[];
      }
      return {};
    },
  });

  const result = await agent.stream({
    messages: [{ role: 'user', content: 'Find and fix the bug.' }],
    writable: new WritableStream(),
  });

  expect(result.steps[0].content).toContainEqual({
    type: 'text',
    text: narration,
  });

  const priorAssistantMessage = secondStepMessages?.find(
    message => message.role === 'assistant',
  );

  expect(priorAssistantMessage?.content).toEqual([
    {
      type: 'text',
      text: narration,
    },
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'applyFix',
      input: {},
    },
  ]);
});
