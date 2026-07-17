import { simulateReadableStream, stepCountIs, streamText, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function toolCallStream(toolCallId: string) {
  return simulateReadableStream({
    initialDelayInMs: 0,
    chunkDelayInMs: 0,
    chunks: [
      {
        type: 'tool-call' as const,
        toolCallId,
        toolName: 'weather',
        input: JSON.stringify({ location: 'Basel' }),
      },
      {
        type: 'finish' as const,
        finishReason: { unified: 'tool-calls' as const, raw: undefined },
        usage,
      },
    ],
  });
}

async function runDirectActiveToolsScenario() {
  let executionCount = 0;
  let providerToolCount: number | undefined;

  const result = streamText({
    model: new MockLanguageModelV3({
      doStream: async ({ tools }) => {
        providerToolCount = tools?.length;
        return { stream: toolCallStream('direct_call') };
      },
    }),
    prompt: 'test',
    tools: {
      weather: tool({
        inputSchema: z.object({ location: z.string() }),
        execute: async ({ location }) => {
          executionCount++;
          return `weather for ${location}`;
        },
      }),
    },
    activeTools: [],
    stopWhen: stepCountIs(1),
  });

  await result.consumeStream();

  return {
    executionCount,
    providerToolCount,
    toolCalls: await result.toolCalls,
    toolResults: await result.toolResults,
  };
}

async function runPrepareStepScenario() {
  let executionCount = 0;
  const providerToolCounts: Array<number | undefined> = [];
  let modelCallCount = 0;

  const result = streamText({
    model: new MockLanguageModelV3({
      doStream: async ({ tools }) => {
        providerToolCounts.push(tools?.length);
        modelCallCount++;
        return { stream: toolCallStream(`prepare_call_${modelCallCount}`) };
      },
    }),
    prompt: 'test',
    tools: {
      weather: tool({
        inputSchema: z.object({ location: z.string() }),
        execute: async ({ location }) => {
          executionCount++;
          return `weather for ${location}`;
        },
      }),
    },
    prepareStep: ({ stepNumber }) =>
      stepNumber === 1 ? { activeTools: [] } : undefined,
    stopWhen: stepCountIs(2),
  });

  await result.consumeStream();

  return {
    executionCount,
    providerToolCounts,
    stepToolCalls: (await result.steps).map(step => step.toolCalls),
    stepToolResults: (await result.steps).map(step => step.toolResults),
  };
}

async function main() {
  const direct = await runDirectActiveToolsScenario();
  const prepareStep = await runPrepareStepScenario();

  console.log(
    JSON.stringify(
      {
        direct,
        prepareStep,
        expected: {
          directExecutionCount: 0,
          prepareStepExecutionCount: 1,
        },
      },
      null,
      2,
    ),
  );

  if (direct.executionCount !== 0 || prepareStep.executionCount !== 1) {
    throw new Error(
      'ISSUE_13448_REPRODUCED: an activeTools-disabled tool execute function ran.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
