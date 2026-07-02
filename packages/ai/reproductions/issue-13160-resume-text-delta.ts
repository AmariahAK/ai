import assert from 'node:assert/strict';
import {
  AbstractChat,
  type ChatInit,
  type ChatState,
  type ChatStatus,
} from '../src/ui/chat';
import type { UIMessageChunk } from '../src/ui-message-stream/ui-message-chunks';
import type { UIMessage } from '../src/ui/ui-messages';

class ReproChatState implements ChatState<UIMessage> {
  status: ChatStatus = 'ready';
  error: Error | undefined;
  messages: UIMessage[];

  constructor(messages: UIMessage[]) {
    this.messages = structuredClone(messages);
  }

  pushMessage = (message: UIMessage) => {
    this.messages = [...this.messages, structuredClone(message)];
  };

  popMessage = () => {
    this.messages = this.messages.slice(0, -1);
  };

  replaceMessage = (index: number, message: UIMessage) => {
    this.messages = [
      ...this.messages.slice(0, index),
      structuredClone(message),
      ...this.messages.slice(index + 1),
    ];
  };

  snapshot = <T>(value: T): T => structuredClone(value);
}

class ReproChat extends AbstractChat<UIMessage> {
  constructor(init: ChatInit<UIMessage>) {
    super({
      ...init,
      state: new ReproChatState(init.messages ?? []),
    });
  }
}

function readableChunks(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

const existingMessages: UIMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Tell me a story.' }],
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    metadata: undefined,
    parts: [
      { type: 'step-start' },
      {
        type: 'text',
        text: 'She lived bravely',
        providerMetadata: undefined,
        state: 'streaming',
      },
    ],
  },
];

const resumedChunks: UIMessageChunk[] = [
  // This mimics resuming from a server-side cursor after the earlier
  // text-start(id="text-1") was already sent, but before text-end.
  { type: 'text-delta', id: 'text-1', delta: ' and loved well' },
  { type: 'text-delta', id: 'text-1', delta: ', and that' },
  { type: 'text-end', id: 'text-1' },
  { type: 'finish' },
];

const observedErrors: Error[] = [];

const chat = new ReproChat({
  id: 'chat-13160',
  messages: existingMessages,
  generateId: () => 'generated-assistant-id',
  transport: {
    sendMessages: async () => {
      throw new Error('sendMessages should not be called by resumeStream');
    },
    reconnectToStream: async () => readableChunks(resumedChunks),
  },
  onError(error) {
    observedErrors.push(error);
  },
});

await chat.resumeStream();

const error = observedErrors.at(-1) ?? chat.error;

assert.equal(chat.status, 'error');
assert(error instanceof Error, 'resumeStream should surface a stream error');
assert.match(
  error.message,
  /Received text-delta for missing text part with ID "text-1"/,
);

console.log('Reproduced issue #13160.');
console.log(`status=${chat.status}`);
console.log(`${error.name}: ${error.message}`);
