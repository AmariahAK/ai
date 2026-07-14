import { tool } from '@ai-sdk/provider-utils';
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import { smoothStream } from './smooth-stream';
import { streamText } from './stream-text';
import type { TextStreamPart } from './stream-text-result';

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

  it('should emit all model-call text before executing tools', async () => {
    let streamedText = '';
    let textObservedWhenToolExecuted: string | undefined;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: 'before tool ' },
            { type: 'text-end', id: '1' },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: JSON.stringify({ path: 'hello.txt' }),
            },
            { type: 'text-start', id: '2' },
            { type: 'text-delta', id: '2', delta: 'after tool ' },
            { type: 'text-end', id: '2' },
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
      prompt: 'Read hello.txt',
    });

    for await (const text of result.textStream) {
      streamedText += text;
    }

    expect(textObservedWhenToolExecuted).toBe('before tool after tool ');
  });

  it('should emit intervening text before executing multiple tools', async () => {
    let streamedText = '';
    const textObservedWhenToolsExecuted: string[] = [];

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: 'before first ' },
            { type: 'text-end', id: '1' },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'readFile',
              input: JSON.stringify({ path: 'hello.txt' }),
            },
            { type: 'text-start', id: '2' },
            { type: 'text-delta', id: '2', delta: 'between tools ' },
            { type: 'text-end', id: '2' },
            {
              type: 'tool-call',
              toolCallId: 'call-2',
              toolName: 'readFile',
              input: JSON.stringify({ path: 'world.txt' }),
            },
            { type: 'text-start', id: '3' },
            { type: 'text-delta', id: '3', delta: 'after second ' },
            { type: 'text-end', id: '3' },
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
            textObservedWhenToolsExecuted.push(streamedText);
            return 'contents';
          },
        }),
      },
      experimental_transform: smoothStream({
        chunking: 'word',
        _internal: {
          delay: () => new Promise(resolve => setTimeout(resolve, 0)),
        },
      }),
      prompt: 'Read both files',
    });

    for await (const text of result.textStream) {
      streamedText += text;
    }

    expect(textObservedWhenToolsExecuted).toStrictEqual([
      'before first between tools after second ',
      'before first between tools after second ',
    ]);
  });

  it('should not depend on a tool-call chunk surviving later transforms', async () => {
    let toolExecuted = false;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: 'before tool ' },
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
            toolExecuted = true;
            return 'Sunny';
          },
        }),
      },
      experimental_transform: [
        smoothStream({
          chunking: 'word',
          _internal: {
            delay: () => new Promise(resolve => setTimeout(resolve, 0)),
          },
        }),
        () =>
          new TransformStream<TextStreamPart<any>, TextStreamPart<any>>({
            transform(chunk, controller) {
              if (chunk.type !== 'tool-call') {
                controller.enqueue(chunk);
              }
            },
          }),
      ],
      prompt: 'Read hello.txt',
    });

    const streamedText = await Promise.race([
      (async () => {
        let text = '';
        for await (const chunk of result.textStream) {
          text += chunk;
        }
        return text;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('stream timed out')), 500),
      ),
    ]);

    expect(streamedText).toBe('before tool ');
    expect(toolExecuted).toBe(true);
  });

  it('should preserve ordering when delayInMs is null', async () => {
    let streamedText = '';
    let textObservedWhenToolExecuted: string | undefined;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: 'before tool ' },
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
        delayInMs: null,
        chunking: 'word',
      }),
      prompt: 'Read hello.txt',
    });

    for await (const text of result.textStream) {
      streamedText += text;
    }

    expect(textObservedWhenToolExecuted).toBe('before tool ');
  });
});
