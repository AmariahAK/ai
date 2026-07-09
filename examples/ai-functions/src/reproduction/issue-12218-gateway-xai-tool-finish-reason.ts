import { createGateway } from '@ai-sdk/gateway';
import { generateText, tool } from 'ai';
import 'dotenv/config';
import { z } from 'zod';

async function main() {
  const gateway = createGateway();

  const result = await generateText({
    model: gateway('xai/grok-4.1-fast-reasoning'),
    prompt: "What's the weather in Seoul? Use the getWeather tool.",
    toolChoice: 'required',
    tools: {
      getWeather: tool({
        description: 'Get weather',
        inputSchema: z.object({ city: z.string() }),
      }),
    },
  });

  const summary = {
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    toolCalls: result.toolCalls.map(toolCall => ({
      toolName: toolCall.toolName,
      toolCallId: toolCall.toolCallId,
      input: toolCall.input,
    })),
    content: result.content,
    responseBody: result.response.body,
    steps: result.steps.map(step => ({
      finishReason: step.finishReason,
      rawFinishReason: step.rawFinishReason,
      toolCalls: step.toolCalls.map(toolCall => ({
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        input: toolCall.input,
      })),
      content: step.content,
      responseBody: step.response.body,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (result.toolCalls.length > 0 && result.finishReason !== 'tool-calls') {
    throw new Error(
      `Issue #12218 reproduced: expected finishReason "tool-calls" when tool calls are present, got ${JSON.stringify(result.finishReason)}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
