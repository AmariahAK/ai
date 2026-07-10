import assert from 'node:assert/strict';
import { isStepCount, Output, tool, ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

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

async function main() {
  const emptyToolsAgent = new ToolLoopAgent({
    model: new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ response: 'empty tools succeeded' }),
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      }),
    }),
    instructions: 'You are a helpful assistant for customer service.',
    callOptionsSchema: z.object({}),
    tools: {},
    stopWhen: isStepCount(5),
    output: Output.object({
      schema: z.object({ response: z.string() }),
    }),
  });

  const emptyToolsResult = await emptyToolsAgent.generate({
    prompt: 'Return a customer-service response.',
    options: {},
  });

  assert.deepEqual(emptyToolsResult.output, {
    response: 'empty tools succeeded',
  });

  let callCount = 0;
  const toolAgent = new ToolLoopAgent({
    model: new MockLanguageModelV4({
      doGenerate: async () => {
        if (callCount++ === 0) {
          return {
            content: [
              {
                type: 'tool-call' as const,
                toolCallType: 'function' as const,
                toolCallId: 'call-1',
                toolName: 'fetchCustomer',
                input: JSON.stringify({ request: 'customer-123' }),
              },
            ],
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
            usage,
            warnings: [],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ response: 'customer data loaded' }),
            },
          ],
          finishReason: { unified: 'stop' as const, raw: 'stop' },
          usage,
          warnings: [],
        };
      },
    }),
    instructions: 'You are a helpful assistant for customer service.',
    callOptionsSchema: z.object({}),
    tools: {
      fetchCustomer: tool({
        description: 'Fetch a customer record.',
        inputSchema: z.object({ request: z.string() }),
        outputSchema: z.object({ response: z.string() }),
        execute: async ({ request }) => ({
          response: `result for ${request}`,
        }),
      }),
    },
    stopWhen: isStepCount(5),
    output: Output.object({
      schema: z.object({ response: z.string() }),
    }),
  });

  const toolResult = await toolAgent.generate({
    prompt: 'Fetch customer-123, then return a structured response.',
    options: {},
  });

  assert.deepEqual(toolResult.output, {
    response: 'customer data loaded',
  });
  assert.equal(toolResult.steps.length, 2);
  assert.equal(toolResult.toolResults.length, 1);

  console.log(
    JSON.stringify(
      {
        emptyToolsOutput: emptyToolsResult.output,
        toolOutput: toolResult.output,
        toolSteps: toolResult.steps.length,
        finishReason: toolResult.finishReason,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
