import { generateText, Output, tool, jsonSchema } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import z from 'zod';

type ChatBotOutput = { messages: string[] };

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
    output: Output.object({ schema: jsonSchema<ChatBotOutput>({ type: 'object', properties: { messages: { type: 'array', items: { type: 'string' } } }, required: ['messages'] }) }),
    maxRetries: 1,
  });

  return result.output.messages;
}
