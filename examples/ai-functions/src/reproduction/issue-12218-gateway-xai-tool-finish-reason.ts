import { createGateway } from '@ai-sdk/gateway';
import { generateText, tool } from 'ai';
import { z } from 'zod';

async function main() {
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
  });

  const result = await generateText({
    model: gateway('xai/grok-4.1-fast-reasoning'),
    prompt: "What's the weather in Seoul?",
    tools: {
      getWeather: tool({
        description: 'Get weather',
        inputSchema: z.object({ city: z.string() }),
      }),
    },
    include: {
      responseBody: true,
    },
  });

  const summary = {
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    toolCalls: result.toolCalls,
    responseBody: result.response.body,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (result.toolCalls.length === 0) {
    throw new Error('Expected at least one tool call.');
  }

  if (result.finishReason !== 'tool-calls') {
    throw new Error(
      `Expected finishReason "tool-calls" when tool calls are present, got ${JSON.stringify(
        result.finishReason,
      )}.`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
