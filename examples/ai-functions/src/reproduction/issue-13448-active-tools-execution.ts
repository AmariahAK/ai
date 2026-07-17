import { simulateReadableStream, stepCountIs, streamText, tool } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import { z } from 'zod';

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
};

function createToolCallingModel(providerToolCounts: number[]) {
  let callCount = 0;

  return new MockLanguageModelV2({
    doStream: async ({ tools }) => {
      providerToolCounts.push(tools?.length ?? 0);
      callCount += 1;

      return {
        stream: simulateReadableStream({
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
          chunks: [
            {
              type: 'tool-call' as const,
              toolCallId: `call_${callCount}`,
              toolName: 'weather',
              input: JSON.stringify({ location: 'Basel' }),
            },
            {
              type: 'finish' as const,
              finishReason: 'tool-calls' as const,
              usage,
            },
          ],
        }),
      };
    },
  });
}

async function runDirectActiveToolsScenario() {
  const providerToolCounts: number[] = [];
  let executions = 0;

  const result = streamText({
    model: createToolCallingModel(providerToolCounts),
    prompt: 'test',
    tools: {
      weather: tool({
        inputSchema: z.object({ location: z.string() }),
        execute: async ({ location }) => {
          executions += 1;
          return `weather for ${location}`;
        },
      }),
    },
    activeTools: [],
    stopWhen: stepCountIs(1),
  });

  await result.consumeStream();

  return {
    executions,
    providerToolCounts,
    toolCalls: await result.toolCalls,
    toolResults: await result.toolResults,
  };
}

async function runPrepareStepScenario() {
  const providerToolCounts: number[] = [];
  let executions = 0;

  const result = streamText({
    model: createToolCallingModel(providerToolCounts),
    prompt: 'test',
    tools: {
      weather: tool({
        inputSchema: z.object({ location: z.string() }),
        execute: async ({ location }) => {
          executions += 1;
          return `weather for ${location}`;
        },
      }),
    },
    stopWhen: stepCountIs(2),
    prepareStep: ({ stepNumber }) => ({
      activeTools: stepNumber === 0 ? ['weather'] : [],
    }),
  });

  await result.consumeStream();
  const steps = await result.steps;

  return {
    executions,
    providerToolCounts,
    stepToolCallCounts: steps.map(step => step.toolCalls.length),
    stepToolResultCounts: steps.map(step => step.toolResults.length),
  };
}

async function main() {
  const direct = await runDirectActiveToolsScenario();
  const prepareStep = await runPrepareStepScenario();

  console.log(JSON.stringify({ direct, prepareStep }, null, 2));

  const directBugReproduced =
    direct.providerToolCounts[0] === 0 &&
    direct.executions === 1 &&
    direct.toolCalls.length === 1 &&
    direct.toolResults.length === 1;

  const prepareStepBugReproduced =
    prepareStep.providerToolCounts.join(',') === '1,0' &&
    prepareStep.executions === 2 &&
    prepareStep.stepToolCallCounts.join(',') === '1,1' &&
    prepareStep.stepToolResultCounts.join(',') === '1,1';

  if (directBugReproduced && prepareStepBugReproduced) {
    throw new Error(
      'ISSUE_13448_REPRODUCED: disabled weather tools executed successfully in both activeTools and prepareStep scenarios',
    );
  }

  if (direct.executions !== 0 || direct.toolResults.length !== 0) {
    throw new Error(`Unexpected direct scenario: ${JSON.stringify(direct)}`);
  }

  if (prepareStep.executions !== 1) {
    throw new Error(
      `Unexpected prepareStep scenario: ${JSON.stringify(prepareStep)}`,
    );
  }
}

await main();
