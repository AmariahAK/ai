import type { GatewayProviderOptions } from '@ai-sdk/gateway';
import { stepCountIs, tool, ToolLoopAgent } from 'ai';
import { z } from 'zod';

async function main() {
  const events: Array<{ type: string; error?: unknown }> = [];

  const agent = new ToolLoopAgent({
    model: 'zai/glm-4.7',
    providerOptions: {
      gateway: {
        only: ['cerebras'],
      } satisfies GatewayProviderOptions,
      cerebras: {},
    },
    tools: {
      getWeather: tool({
        description: 'Get the current weather for a city.',
        inputSchema: z.object({
          city: z.string(),
        }),
        execute: async ({ city }) => ({
          city,
          condition: 'sunny',
          temperatureFahrenheit: 72,
        }),
      }),
    },
    toolChoice: 'required',
    stopWhen: [stepCountIs(1)],
  });

  const result = await agent.stream({
    prompt:
      'Call the getWeather tool exactly once for San Francisco. Do not answer without calling the tool.',
  });

  for await (const event of result.fullStream) {
    events.push({
      type: event.type,
      ...('error' in event ? { error: event.error } : {}),
    });
  }

  const errorEvents = events.filter(event => event.type === 'error');
  const toolCallEvents = events.filter(event => event.type === 'tool-call');
  const toolResultEvents = events.filter(event => event.type === 'tool-result');
  const steps = await result.steps;
  const providerMetadata = await result.providerMetadata;

  console.log(
    JSON.stringify(
      {
        eventTypes: events.map(event => event.type),
        errors: errorEvents,
        toolCallCount: toolCallEvents.length,
        toolResultCount: toolResultEvents.length,
        stepCount: steps.length,
        finishReason: await result.finishReason,
        providerMetadata,
      },
      null,
      2,
    ),
  );

  if (errorEvents.length > 0) {
    throw new Error(
      `Issue #11783 reproduced: agent stream emitted ${errorEvents.length} error event(s).`,
    );
  }

  if (toolCallEvents.length !== 1 || toolResultEvents.length !== 1) {
    throw new Error(
      `Expected one tool call and one tool result, received ${toolCallEvents.length} and ${toolResultEvents.length}.`,
    );
  }

  if (steps.length !== 1) {
    throw new Error(
      `Expected stopWhen to stop after one step, got ${steps.length}.`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
