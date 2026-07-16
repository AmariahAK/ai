import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { printFullStream } from '../../lib/print-full-stream';
import { run } from '../../lib/run';
import { print } from '../../lib/print';

run(async () => {
  const result = streamText({
    model: openai('gpt-5-nano'),
    prompt: 'Write a short poem about the ocean.',
    timeout: {
      firstChunkMs: 10_000,
      chunkMs: 5_000,
    },
  });

  printFullStream({ result });

  print('Usage:', await result.usage);
  print('Finish reason:', await result.finishReason);
});
