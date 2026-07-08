import type { LanguageModelV4 } from '@ai-sdk/provider';
import {
  generateImage,
  generateText,
  embed,
  jsonSchema,
  streamText,
  tool,
  type InferToolInput,
  type InferToolOutput,
  type LanguageModel,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { Chat as AngularChat } from '@ai-sdk/angular';
import type { useChat as useReactChat } from '@ai-sdk/react';
import type { Chat as SvelteChat } from '@ai-sdk/svelte';
import type { useChat as useVueChat } from '@ai-sdk/vue';

const openai = createOpenAI({ apiKey: 'compatibility-test' });
const model = openai('gpt-4.1');

const providerModel: LanguageModelV4 = model;
const languageModel: LanguageModel = providerModel;

const lookup = tool({
  inputSchema: jsonSchema<{ id: string }>({
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  }),
  execute: async ({ id }) => ({ id, found: true as const }),
});

const input: InferToolInput<typeof lookup> = { id: 'item' };
const output: InferToolOutput<typeof lookup> = {
  id: 'item',
  found: true,
};

const generated = generateText({
  model: languageModel,
  prompt: 'Find an item.',
  tools: { lookup },
});

const streamed = streamText({
  model,
  prompt: 'Find an item.',
  tools: { lookup },
});

const embedded = embed({
  model: openai.embedding('text-embedding-3-small'),
  value: 'compatibility',
});

const image = generateImage({
  model: openai.image('gpt-image-1'),
  prompt: 'A compatibility matrix',
});

type ReactChatApi = typeof useReactChat;
type VueChatApi = typeof useVueChat;
type SvelteChatApi = typeof SvelteChat;
type AngularChatApi = typeof AngularChat;

void input;
void output;
void generated;
void streamed;
void embedded;
void image;
void (0 as unknown as ReactChatApi);
void (0 as unknown as VueChatApi);
void (0 as unknown as SvelteChatApi);
void (0 as unknown as AngularChatApi);

export {};
