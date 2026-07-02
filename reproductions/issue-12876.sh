#!/usr/bin/env bash
set -u -o pipefail

# Reproduction for vercel/ai issue #12876 using the reported AI SDK package versions
# plus a valid peer Zod v4 version that emits oneOf for discriminated unions.
# Requires a live Anthropic key because the reported failure is returned by Anthropic.

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Missing ANTHROPIC_API_KEY. Set it to run the live Anthropic reproduction." >&2
  exit 2
fi

REPRO_DIR="${TMPDIR:-/tmp}/vercel-ai-issue-12876"
rm -rf "$REPRO_DIR"
mkdir -p "$REPRO_DIR"
cd "$REPRO_DIR" || exit 2

npm init -y >/dev/null
npm install --silent ai@6.0.39 @ai-sdk/anthropic@3.0.47 zod@4.4.3

cat > repro.mjs <<'JS'
import { generateText, Output } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const modelId = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const schema = z.object({
  cars: z.discriminatedUnion('brand', [
    z.object({ brand: z.literal('BMW') }),
    z.object({ brand: z.literal('Mercedes') }),
  ]),
});

const responseFormat = await Output.object({ schema }).responseFormat;
console.log('Generated response format schema:');
console.log(JSON.stringify(responseFormat.schema, null, 2));

try {
  const { output } = await generateText({
    model: anthropic(modelId),
    output: Output.object({ schema }),
    messages: [
      { role: 'user', content: 'What is the most used car brand worldwide?' },
    ],
    maxOutputTokens: 200,
  });

  console.log('Unexpected success:', output);
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Observed error message:');
  console.error(message);
  if (error && typeof error === 'object') {
    if ('name' in error) console.error('name:', error.name);
    if ('statusCode' in error) console.error('statusCode:', error.statusCode);
    if ('responseBody' in error) console.error('responseBody:', error.responseBody);
  }

  if (message.includes("output_format.schema: Schema type 'oneOf' is not supported")) {
    console.error('Reproduced issue #12876.');
    process.exit(1);
  }

  console.error('The live call failed, but not with the reported oneOf error.');
  process.exit(3);
}
JS

node repro.mjs
