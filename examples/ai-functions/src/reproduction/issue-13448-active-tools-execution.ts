import {
  NoSuchToolError,
  simulateReadableStream,
  stepCountIs,
  streamText,
  tool,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function createToolCallStream(toolCallId: string) {
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

  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: createToolCallStream('direct-call'),
    }),
  });

  const result = streamText({
    model,
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
    providerToolCounts: model.doStreamCalls.map(
      call => call.tools?.length ?? 0,
    ),
    toolCalls: await result.toolCalls,
    toolResults: await result.toolResults,
  };
}

async function runPrepareStepScenario() {
  let executionCount = 0;
  let streamCallCount = 0;

  const model = new MockLanguageModelV3({
    doStream: async () => {
      streamCallCount++;
      return {
        stream: createToolCallStream(`prepare-step-call-${streamCallCount}`),
      };
    },
  });

  const result = streamText({
    model,
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
      stepNumber === 0 ? { activeTools: ['weather'] } : { activeTools: [] },
    stopWhen: stepCountIs(2),
  });

  await result.consumeStream();

  return {
    executionCount,
    providerToolCounts: model.doStreamCalls.map(
      call => call.tools?.length ?? 0,
    ),
    steps: (await result.steps).map(step => ({
      toolCalls: step.toolCalls,
      toolResults: step.toolResults,
    })),
  };
}

async function main() {
  const direct = await runDirectActiveToolsScenario();
  const prepareStep = await runPrepareStepScenario();

  console.log(JSON.stringify({ direct, prepareStep }, null, 2));

  const directDisabledToolExecuted =
    direct.executionCount !== 0 || direct.toolResults.length !== 0;
  const directDisabledToolWasNotRejected =
    direct.toolCalls[0]?.invalid !== true ||
    !NoSuchToolError.isInstance(direct.toolCalls[0].error);
  const prepareStepDisabledToolExecuted =
    prepareStep.executionCount !== 1 ||
    prepareStep.steps[1]?.toolResults.length !== 0;
  const prepareStepDisabledToolWasNotRejected =
    prepareStep.steps[1]?.toolCalls[0]?.invalid !== true ||
    !NoSuchToolError.isInstance(prepareStep.steps[1].toolCalls[0].error);

  if (directDisabledToolExecuted || prepareStepDisabledToolExecuted) {
    throw new Error(
      `Reproduced issue #13448: disabled tools executed (direct=${direct.executionCount}, prepareStep=${prepareStep.executionCount}).`,
    );
  }

  if (
    directDisabledToolWasNotRejected ||
    prepareStepDisabledToolWasNotRejected
  ) {
    throw new Error(
      'Disabled tool calls were not surfaced as NoSuchTool errors.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
