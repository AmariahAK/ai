import 'dotenv/config';
import { openai } from '@ai-sdk/openai';
import { Output, stepCountIs, tool, ToolLoopAgent } from 'ai';
import { z } from 'zod';

const output = Output.object({
  schema: z.object({
    response: z.string(),
  }),
});

async function generateWithoutToolCall() {
  const agent = new ToolLoopAgent({
    model: openai('gpt-5'),
    instructions: 'You are a helpful assistant for customer service.',
    tools: {},
    stopWhen: stepCountIs(5),
    output,
    callOptionsSchema: z.object({}),
  });

  return agent.generate({
    prompt:
      'Return a customer service response confirming that support is ready.',
    options: {},
  });
}

async function generateAfterToolCall() {
  let toolExecutionCount = 0;

  const agent = new ToolLoopAgent({
    model: openai('gpt-5'),
    instructions:
      'You are a helpful assistant for customer service. Use the supplied customer data in the final structured response.',
    tools: {
      loadCustomerData: tool({
        description: 'Load customer data.',
        inputSchema: z.object({}),
        outputSchema: z.object({
          response: z.string(),
        }),
        execute: async () => {
          toolExecutionCount += 1;
          return { response: 'customer data loaded' };
        },
      }),
    },
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0
        ? {
            toolChoice: {
              type: 'tool',
              toolName: 'loadCustomerData',
            },
          }
        : {
            activeTools: [],
            toolChoice: 'none',
          },
    stopWhen: stepCountIs(5),
    output,
    callOptionsSchema: z.object({}),
  });

  const result = await agent.generate({
    prompt:
      'Load the customer data, then return a structured customer service response.',
    options: {},
  });

  return { result, toolExecutionCount };
}

async function main() {
  const withoutToolCall = await generateWithoutToolCall();
  const withToolCall = await generateAfterToolCall();

  const observed = {
    withoutToolCall: {
      output: withoutToolCall.output,
      stepCount: withoutToolCall.steps.length,
      finishReason: withoutToolCall.finishReason,
    },
    withToolCall: {
      output: withToolCall.result.output,
      stepCount: withToolCall.result.steps.length,
      finishReason: withToolCall.result.finishReason,
      toolExecutionCount: withToolCall.toolExecutionCount,
    },
  };

  console.log(JSON.stringify(observed, null, 2));

  if (observed.withoutToolCall.output.response.length === 0) {
    throw new Error(
      'Issue #9798 reproduced: the agent returned no structured output with tools: {}.',
    );
  }

  if (observed.withToolCall.toolExecutionCount !== 1) {
    throw new Error(
      `Expected one tool execution, received ${observed.withToolCall.toolExecutionCount}.`,
    );
  }

  if (observed.withToolCall.output.response.length === 0) {
    throw new Error(
      'Issue #9798 reproduced: the agent returned no structured output after a tool call.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
