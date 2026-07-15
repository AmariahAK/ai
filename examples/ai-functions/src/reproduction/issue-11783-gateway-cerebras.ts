import assert from 'node:assert/strict';
import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { z } from 'zod';

async function main() {
  const agent = new ToolLoopAgent({
    model: 'zai/glm-4.7',
    providerOptions: {
      gateway: {
        only: ['cerebras'],
      },
      cerebras: {},
    },
    stopWhen: [stepCountIs(1)],
    toolChoice: 'required',
    tools: {
      getWeather: tool({
        description: 'Get the weather for a city.',
        inputSchema: z.object({
          city: z.string(),
        }),
        execute: async ({ city }) => ({
          city,
          conditions: 'sunny',
          temperatureFahrenheit: 72,
        }),
      }),
    },
  });

  const result = await agent.stream({
    prompt:
      'Call the getWeather tool exactly once for San Francisco. Do not answer without calling the tool.',
  });

  const observedPartTypes: string[] = [];
  const errors: unknown[] = [];
  let toolCallCount = 0;
  let toolResultCount = 0;

  for await (const part of result.fullStream) {
    observedPartTypes.push(part.type);

    if (part.type === 'tool-call') {
      toolCallCount += 1;
      console.log(
        JSON.stringify({
          type: part.type,
          toolName: part.toolName,
          input: part.input,
        }),
      );
    } else if (part.type === 'tool-result') {
      toolResultCount += 1;
      console.log(
        JSON.stringify({
          type: part.type,
          toolName: part.toolName,
          output: part.output,
        }),
      );
    } else if (part.type === 'error') {
      errors.push(part.error);
      console.error(
        JSON.stringify({
          type: part.type,
          error:
            part.error instanceof Error
              ? {
                  name: part.error.name,
                  message: part.error.message,
                  stack: part.error.stack,
                }
              : part.error,
        }),
      );
    }
  }

  console.log(
    JSON.stringify({
      observedPartTypes,
      toolCallCount,
      toolResultCount,
      errorCount: errors.length,
      finishReason: await result.finishReason,
      providerMetadata: await result.providerMetadata,
    }),
  );

  assert.equal(
    errors.length,
    0,
    `Expected no stream errors, received ${errors.length}.`,
  );
  assert.equal(toolCallCount, 1, 'Expected exactly one tool call.');
  assert.equal(toolResultCount, 1, 'Expected exactly one tool result.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
