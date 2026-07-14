import { anthropic } from '@ai-sdk/anthropic';
import { smoothStream, streamText, tool } from 'ai';
import { z } from 'zod';
import { run } from '../../lib/run';

run(async () => {
  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    prompt:
      'Use the weather tool to check the weather in London, United Kingdom.',
    tools: {
      weather: tool({
        description: 'Get the weather for a location.',
        inputSchema: z.object({
          city: z.string(),
          country: z.string(),
        }),
        execute: async input => ({
          ...input,
          temperature: 18,
          condition: 'partly cloudy',
        }),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'weather' },
    experimental_transform: smoothStream({
      delayInMs: 5,
      toolInputSmoothing: {},
    }),
  });

  const toolInputDeltas: string[] = [];

  for await (const part of result.fullStream) {
    if (part.type === 'tool-input-delta') {
      toolInputDeltas.push(part.delta);
      process.stdout.write(part.delta);
    }
  }

  console.log();

  if (
    toolInputDeltas.length === 0 ||
    toolInputDeltas.some(delta => [...delta].length !== 1)
  ) {
    throw new Error('Expected character-by-character tool input deltas.');
  }
});
