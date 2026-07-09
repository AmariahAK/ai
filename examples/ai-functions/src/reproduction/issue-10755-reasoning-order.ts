import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';

const encoder = new TextEncoder();

function sseResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

const firstStepChunks = [
  `data: {"id":"chatcmpl-issue-10755-step-1","object":"chat.completion.chunk","created":1711357598,"model":"z-ai/glm-4.5-air:free","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning_content":"I need to call get_weather for Shanghai Zhangjiang."},"finish_reason":null}]}\n\n`,
  `data: {"id":"chatcmpl-issue-10755-step-1","object":"chat.completion.chunk","created":1711357598,"model":"z-ai/glm-4.5-air:free","choices":[{"index":0,"delta":{"content":"I'll check the weather first."},"finish_reason":null}]}\n\n`,
  `data: {"id":"chatcmpl-issue-10755-step-1","object":"chat.completion.chunk","created":1711357598,"model":"z-ai/glm-4.5-air:free","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_weather_1","type":"function","function":{"name":"get_weather","arguments":"{\\\"city\\\":\\\"上海张江\\\"}"}}]},"finish_reason":null}]}\n\n`,
  `data: {"id":"chatcmpl-issue-10755-step-1","object":"chat.completion.chunk","created":1711357599,"model":"z-ai/glm-4.5-air:free","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":30,"completion_tokens":20,"total_tokens":50,"completion_tokens_details":{"reasoning_tokens":8}}}\n\n`,
  'data: [DONE]\n\n',
];

const secondStepChunks = [
  `data: {"id":"chatcmpl-issue-10755-step-2","object":"chat.completion.chunk","created":1711357600,"model":"z-ai/glm-4.5-air:free","choices":[{"index":0,"delta":{"role":"assistant","content":"It is sunny and 26°C. A short-sleeve shirt should be comfortable."},"finish_reason":null}]}\n\n`,
  `data: {"id":"chatcmpl-issue-10755-step-2","object":"chat.completion.chunk","created":1711357601,"model":"z-ai/glm-4.5-air:free","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":60,"completion_tokens":15,"total_tokens":75,"completion_tokens_details":{"reasoning_tokens":0}}}\n\n`,
  'data: [DONE]\n\n',
];

async function main() {
  let callCount = 0;
  const provider = createOpenAICompatible({
    name: 'openrouter-mock',
    baseURL: 'https://openrouter.example/api/v1',
    fetch: async () => {
      callCount += 1;
      if (callCount === 1) {
        return sseResponse(firstStepChunks);
      }
      if (callCount === 2) {
        return sseResponse(secondStepChunks);
      }
      throw new Error(`Unexpected fetch call ${callCount}`);
    },
  });

  const agent = new ToolLoopAgent({
    model: provider.languageModel('z-ai/glm-4.5-air:free'),
    instructions: 'You are a helpful assistant.',
    tools: {
      get_weather: tool({
        description: 'Get the weather in a location',
        inputSchema: z.object({
          city: z.string(),
        }),
        execute: async ({ city }) => ({
          city,
          temperature: 26,
          condition: 'sunny',
        }),
      }),
    },
  });

  const result = await agent.stream({
    prompt: '上海张江的天气怎么样，我该穿什么合适?',
  });

  const parts = [];
  for await (const part of result.fullStream) {
    parts.push(part);
  }

  const eventTypes = parts.map(part => part.type);
  const positions = {
    reasoningStart: eventTypes.indexOf('reasoning-start'),
    reasoningEnd: eventTypes.indexOf('reasoning-end'),
    textStart: eventTypes.indexOf('text-start'),
    toolInputStart: eventTypes.indexOf('tool-input-start'),
    toolCall: eventTypes.indexOf('tool-call'),
    toolResult: eventTypes.indexOf('tool-result'),
  };

  console.log('Observed fullStream event order:');
  console.log(eventTypes.join(' -> '));
  console.log('Relevant positions:', positions);

  if (positions.reasoningEnd === -1) {
    throw new Error('Expected a reasoning-end event, but none was emitted.');
  }

  if (positions.reasoningEnd > positions.textStart) {
    throw new Error(
      'Reproduced issue #10755: reasoning-end was emitted after text-start.',
    );
  }

  if (positions.reasoningEnd > positions.toolCall) {
    throw new Error(
      'Reproduced issue #10755: reasoning-end was emitted after tool-call.',
    );
  }

  console.log(
    'Issue #10755 was not reproduced: reasoning-end was emitted before text-start and before tool-call.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
