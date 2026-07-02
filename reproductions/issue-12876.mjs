#!/usr/bin/env node
import { generateText, Output } from '../packages/ai/dist/index.js';
import { anthropic } from '../packages/anthropic/dist/index.js';
import { z } from '../packages/anthropic/node_modules/zod/index.js';

const modelId = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY. Set it to run the live Anthropic reproduction.');
  process.exit(2);
}

const schema = z.object({
  cars: z.discriminatedUnion('brand', [
    z.object({ brand: z.literal('BMW') }),
    z.object({ brand: z.literal('Mercedes') }),
  ]),
});

try {
  const result = await generateText({
    model: anthropic(modelId),
    output: Output.object({ schema }),
    messages: [
      {
        role: 'user',
        content:
          'Return a JSON object choosing either BMW or Mercedes as the most used car brand worldwide.',
      },
    ],
    maxOutputTokens: 200,
  });

  console.log('generateText succeeded unexpectedly. Structured output:', result.output);
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('generateText failed with message:');
  console.error(message);

  if (error && typeof error === 'object') {
    console.error('error name:', error.name);
    if ('statusCode' in error) console.error('statusCode:', error.statusCode);
    if ('responseBody' in error) console.error('responseBody:', error.responseBody);
    if ('cause' in error && error.cause) console.error('cause:', error.cause);
  }

  if (message.includes("Schema type 'oneOf' is not supported")) {
    console.error('Reproduced issue #12876: Anthropic rejected the oneOf generated for a Zod discriminated union.');
    process.exit(1);
  }

  console.error('Did not observe the exact reported oneOf error.');
  process.exit(3);
}
