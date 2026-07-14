import assert from 'node:assert/strict';
import { generateObject, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from '../../../../node_modules/.pnpm/zod@4.1.11/node_modules/zod/index.js';

async function main() {
  const objectSchema = z.object({ content: z.string() });
  const inputSchema = z.object({ name: z.string() });

  const greetingTool = tool({
    inputSchema,
    execute: async ({ name }) => `Hello, ${name}!`,
  });

  assert.equal(greetingTool.inputSchema, inputSchema);

  const result = await generateObject({
    model: new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: 'text', text: '{"content":"Hello, world!"}' }],
        finishReason: { raw: undefined, unified: 'stop' },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 1,
            text: 1,
            reasoning: undefined,
          },
        },
        warnings: [],
      }),
    }),
    schema: objectSchema,
    prompt: 'Return a greeting.',
  });

  assert.deepEqual(result.object, { content: 'Hello, world!' });
  console.log(
    'Zod 4.1.11 schemas were accepted by tool() and generateObject().',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
