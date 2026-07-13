import { tool, type ModelMessage } from 'ai';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { z } from 'zod/v4';
import { WorkflowAgent } from '../../../../packages/workflow/dist/index.js';

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

async function main() {
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

  const firstStep = result.steps[0];
  const priorAssistantMessage = secondStepMessages?.find(
    message => message.role === 'assistant',
  );
  const priorAssistantContent = Array.isArray(priorAssistantMessage?.content)
    ? priorAssistantMessage.content
    : [];
  const narrationWasGenerated = firstStep?.content.some(
    part => part.type === 'text' && part.text === narration,
  );
  const narrationWasCarriedForward = priorAssistantContent.some(
    part => part.type === 'text' && part.text === narration,
  );

  console.log(
    JSON.stringify(
      {
        firstStepFinishReason: firstStep?.finishReason,
        firstStepContent: firstStep?.content,
        secondStepAssistantContent: priorAssistantContent,
        narrationWasGenerated,
        narrationWasCarriedForward,
      },
      null,
      2,
    ),
  );

  if (!narrationWasGenerated) {
    throw new Error('The mock model did not generate the expected narration.');
  }

  if (!narrationWasCarriedForward) {
    throw new Error(
      'Reproduced issue #17123: WorkflowAgent dropped assistant text from the prompt after a tool-calls finish.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
