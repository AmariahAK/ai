import { tool } from '@ai-sdk/provider-utils';
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import { smoothStream } from './smooth-stream';
import { streamText } from './stream-text';

const usage = {
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
};

describe('smoothStream tool ordering', () => {
  it('should emit preceding text before executing a tool call', async () => {
    const textBeforeTool =
      'I will help replace Sunny with Rainy. First, let me read the file. ';
    let streamedText = '';
    let textObservedWhenToolExecuted: string | undefined;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            { type: 'text-start', id: '1' },
            {
              type: 'text-delta',
              id: '1',
              delta: textBeforeTool,
            },
            { type: 'text-end', id: '1' },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: JSON.stringify({ path: 'hello.txt' }),
            },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
              usage,
            },
          ]),
        }),
      }),
      tools: {
        readFile: tool({
          inputSchema: z.object({ path: z.string() }),
          execute: async () => {
            textObservedWhenToolExecuted = streamedText;
            return 'Sunny';
          },
        }),
      },
      experimental_transform: smoothStream({
        chunking: 'word',
        _internal: {
          delay: () => new Promise(resolve => setTimeout(resolve, 0)),
        },
      }),
      prompt: 'Replace Sunny with Rainy in hello.txt',
    });

    for await (const text of result.textStream) {
      streamedText += text;
    }

    expect(textObservedWhenToolExecuted).toBe(textBeforeTool);
  });
});
