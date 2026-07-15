import assert from 'node:assert/strict';
import { stepCountIs, tool, ToolLoopAgent } from 'ai';
import { z } from 'zod';

function getRoutingMetadata(providerMetadata: unknown) {
  if (providerMetadata == null || typeof providerMetadata !== 'object') {
    return undefined;
  }

  const gateway = Reflect.get(providerMetadata, 'gateway');
  if (gateway == null || typeof gateway !== 'object') {
    return undefined;
  }

  const routing = Reflect.get(gateway, 'routing');
  return routing != null && typeof routing === 'object' ? routing : undefined;
}

async function main() {
  const agent = new ToolLoopAgent({
    model: 'zai/glm-4.7',
    providerOptions: {
      gateway: {
        only: ['cerebras'],
      },
      cerebras: {},
    },
    tools: {
      echo: tool({
        description: 'Echo the supplied value',
        inputSchema: z.object({
          value: z.string(),
        }),
        execute: async ({ value }) => ({ value }),
      }),
    },
    toolChoice: 'required',
    stopWhen: [stepCountIs(1)],
  });

  const result = await agent.stream({
    prompt: 'Call the echo tool exactly once with value issue-11783.',
  });

  const streamErrors: unknown[] = [];
  for await (const part of result.fullStream) {
    if (part.type === 'error') {
      streamErrors.push(part.error);
    }
  }

  assert.deepEqual(
    streamErrors,
    [],
    'Expected the agent stream to complete without an error event.',
  );

  const steps = await result.steps;
  assert.equal(
    steps.length,
    1,
    'Expected stepCountIs(1) to stop after one step.',
  );
  assert.equal(steps[0].toolCalls.length, 1, 'Expected one tool call.');
  assert.equal(steps[0].toolResults.length, 1, 'Expected one tool result.');

  const routing = getRoutingMetadata(steps[0].providerMetadata);
  assert.equal(
    routing && Reflect.get(routing, 'finalProvider'),
    'cerebras',
    'Expected the Gateway to route the request to Cerebras.',
  );

  console.log(
    JSON.stringify(
      {
        expected:
          'ToolLoopAgent.stream completes one tool step without an error when stopWhen is [stepCountIs(1)].',
        observed: {
          finishReason: await result.finishReason,
          stepCount: steps.length,
          toolCallCount: steps[0].toolCalls.length,
          toolResultCount: steps[0].toolResults.length,
          finalProvider: routing && Reflect.get(routing, 'finalProvider'),
          streamErrorCount: streamErrors.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
