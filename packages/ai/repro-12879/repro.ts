import { generateText, Output, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import z from 'zod';

const schema = z.object({
  messages: z.array(z.string()).min(1).max(3),
});

const tools = {
  getProfile: tool({
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => ({ id, name: 'Ada' }),
  }),
};

export async function run() {
  const result = await generateText({
    model: new MockLanguageModelV4() as any,
    system: 'You are helpful',
    prompt: 'Generate the messages now.',
    tools,
    output: Output.object({ schema }),
    maxRetries: 1,
  });

  return result.output.messages;
}
