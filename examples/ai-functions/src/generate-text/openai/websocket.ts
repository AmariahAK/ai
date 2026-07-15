import { openai } from '@ai-sdk/openai';
import { generateText, isStepCount } from 'ai';
import { print } from '../../lib/print';
import { run } from '../../lib/run';
import { weatherTool } from '../../tools/weather-tool';

run(async () => {
  const result = await generateText({
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

  print('Text:', result.text);
  print('Steps:', result.steps.length);
});
