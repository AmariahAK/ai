import type { LanguageModelV4Usage } from '@ai-sdk/provider';
import { dynamicTool, stepCountIs, streamText } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

const usage: LanguageModelV4Usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 5,
    text: 5,
    reasoning: undefined,
  },
};

type FinishSummary = {
  toolCallIds: string[];
  toolResultIds: string[];
  stepToolCallCounts: number[];
  stepToolResultCounts: number[];
  finalStepToolCallCount: number;
  finalStepToolResultCount: number;
};

async function main() {
  let responseCount = 0;
  let finishSummary: FinishSummary | undefined;

  const model = new MockLanguageModelV4({
    doStream: async () => {
      switch (responseCount++) {
        case 0:
          return {
            stream: convertArrayToReadableStream([
              {
                type: 'tool-call',
                toolCallId: 'call-list-my-issues',
                toolName: 'list_my_issues',
                input: JSON.stringify({
                  limit: 5,
                  orderBy: 'updatedAt',
                }),
              },
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
                usage,
              },
            ]),
          };
        case 1:
          return {
            stream: convertArrayToReadableStream([
              { type: 'text-start', id: 'text-1' },
              {
                type: 'text-delta',
                id: 'text-1',
                delta: 'Here are your 5 latest Linear issues.',
              },
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage,
              },
            ]),
          };
        default:
          throw new Error(`Unexpected model response ${responseCount}`);
      }
    },
  });

  const result = streamText({
    model,
    prompt: 'Fetch my latest Linear issues.',
    stopWhen: stepCountIs(10),
    tools: {
      list_my_issues: dynamicTool({
        inputSchema: z.object({
          limit: z.number(),
          orderBy: z.string(),
        }),
        execute: async () => ({
          issues: ['ISSUE-5'],
        }),
      }),
    },
    onFinish(event) {
      finishSummary = {
        toolCallIds: event.toolCalls.map(call => call.toolCallId),
        toolResultIds: event.toolResults.map(result => result.toolCallId),
        stepToolCallCounts: event.steps.map(step => step.toolCalls.length),
        stepToolResultCounts: event.steps.map(step => step.toolResults.length),
        finalStepToolCallCount: event.finalStep.toolCalls.length,
        finalStepToolResultCount: event.finalStep.toolResults.length,
      };
    },
  });

  await result.consumeStream();

  if (finishSummary == null) {
    throw new Error('The stream completed without invoking onFinish.');
  }

  const observed = {
    onFinishToolCallIds: finishSummary.toolCallIds,
    onFinishToolResultIds: finishSummary.toolResultIds,
    stepToolCallCounts: finishSummary.stepToolCallCounts,
    stepToolResultCounts: finishSummary.stepToolResultCounts,
    finalStepToolCallCount: finishSummary.finalStepToolCallCount,
    finalStepToolResultCount: finishSummary.finalStepToolResultCount,
  };

  console.log(
    JSON.stringify(
      {
        expectedIssueBehavior:
          'onFinish has empty top-level toolCalls and toolResults even though an earlier step executed a tool.',
        observed,
      },
      null,
      2,
    ),
  );

  if (
    observed.onFinishToolCallIds.length === 0 ||
    observed.onFinishToolResultIds.length === 0
  ) {
    throw new Error(
      'Reproduced issue #8578: onFinish omitted tool information from an earlier step.',
    );
  }

  if (
    observed.finalStepToolCallCount !== 0 ||
    observed.finalStepToolResultCount !== 0
  ) {
    throw new Error(
      'The narrowing scenario is invalid: the final text step unexpectedly contains tool information.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
