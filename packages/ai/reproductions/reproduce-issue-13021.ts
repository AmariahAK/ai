import assert from 'node:assert/strict';
import {
  createStreamingUIMessageState,
  processUIMessageStream,
  type StreamingUIMessageState,
} from '../src/ui/process-ui-message-stream.ts';
import type { UIMessageChunk } from '../src/ui-message-stream/ui-message-chunks.ts';
import type { UIMessage } from '../src/ui/ui-messages.ts';

/**
 * Reproduction for vercel/ai issue #13021.
 *
 * Run from the repository root:
 *
 *   pnpm exec tsx packages/ai/reproductions/reproduce-issue-13021.ts
 *
 * It simulates the UI message stream shape produced by a freeform OpenAI
 * custom tool (`openai.tools.customTool({ format: { type: 'text' } })`):
 * `tool-input-delta` chunks contain raw text rather than JSON.
 *
 * Expected: the `input-streaming` tool part exposes the progressively
 * accumulated raw text, so UI components rendering `part.input` update live.
 *
 * Current behavior: `processUIMessageStream` parses the accumulated text as
 * partial JSON, so raw text stays `undefined` until `tool-input-available`.
 */

function readableStreamFromArray<T>(items: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const item of items) {
        controller.enqueue(item);
      }
      controller.close();
    },
  });
}

async function consumeStream(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) {
      return;
    }
  }
}

function toolInputsByWrite(messages: UIMessage[]): Array<{
  state: string | undefined;
  input: unknown;
}> {
  return messages
    .map(message =>
      message.parts.find(part => part.type === 'tool-setHtml'),
    )
    .filter((part): part is Extract<UIMessage['parts'][number], { type: 'tool-setHtml' }> =>
      part != null,
    )
    .map(part => ({
      state: part.state,
      input: part.input,
    }));
}

const chunks: UIMessageChunk[] = [
  { type: 'start', messageId: 'msg-13021' },
  { type: 'start-step' },
  {
    type: 'tool-input-start',
    toolCallId: 'tool-call-13021',
    toolName: 'setHtml',
  },
  {
    type: 'tool-input-delta',
    toolCallId: 'tool-call-13021',
    inputTextDelta: 'SELECT * ',
  },
  {
    type: 'tool-input-delta',
    toolCallId: 'tool-call-13021',
    inputTextDelta: 'FROM users ',
  },
  {
    type: 'tool-input-available',
    toolCallId: 'tool-call-13021',
    toolName: 'setHtml',
    input: 'SELECT * FROM users ',
  },
  { type: 'finish-step' },
  { type: 'finish' },
];

let state: StreamingUIMessageState<UIMessage> = createStreamingUIMessageState({
  messageId: 'msg-13021',
  lastMessage: undefined,
});
const writeMessages: UIMessage[] = [];

await consumeStream(
  processUIMessageStream({
    stream: readableStreamFromArray(chunks),
    runUpdateMessageJob: async job =>
      job({
        state,
        write: () => {
          writeMessages.push(structuredClone(state.message));
        },
      }),
    onError: error => {
      throw error;
    },
  }),
);

const toolWrites = toolInputsByWrite(writeMessages);
console.log('Observed tool part writes:', JSON.stringify(toolWrites, null, 2));

assert.deepEqual(
  toolWrites.map(write => write.input),
  [
    undefined,
    'SELECT * ',
    'SELECT * FROM users ',
    'SELECT * FROM users ',
  ],
  'Expected raw text custom-tool input to live-update during tool-input-delta streaming.',
);
