import { openai } from '@ai-sdk/openai';
import { isStepCount, streamText } from 'ai';
import { run } from '../../lib/run';
import { weatherTool } from '../../tools/weather-tool';

run(async () => {
  const result = streamText({
    model: openai('gpt-5'),
    prompt: 'What is the weather in San Francisco?',
    tools: { weather: weatherTool },
    stopWhen: isStepCount(3),
    providerOptions: {
      openai: {
        transport: 'websocket',
      },
    },
  });

  for await (const part of result.textStream) {
    process.stdout.write(part);
  }
});
