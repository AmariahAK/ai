import type {
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { DelayedPromise } from '@ai-sdk/provider-utils';
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { MockLanguageModelV4 } from '../test/mock-language-model-v4';
import { isStepCount } from './stop-condition';
import { streamText } from './stream-text';

const testUsage: LanguageModelV4Usage = {
  inputTokens: {
    total: 3,
    noCache: 3,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 10,
    text: 10,
    reasoning: undefined,
  },
};

describe('streamText firstChunkMs', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should arm only after the provider response stream starts', async () => {
    let receivedAbortSignal: AbortSignal | undefined;
    const responsePromise = new DelayedPromise<void>();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignal = abortSignal;
          await responsePromise.promise;
          return {
            stream: convertArrayToReadableStream([
              { type: 'text-start', id: '1' },
              { type: 'text-delta', id: '1', delta: 'Hello' },
              { type: 'text-end', id: '1' },
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: testUsage,
              },
            ]),
          };
        },
      }),
      prompt: 'test-input',
      timeout: { firstChunkMs: 50 },
      onError: () => {},
    });

    const consumePromise = result.consumeStream();

    await vi.advanceTimersByTimeAsync(100);
    expect(receivedAbortSignal?.aborted).toBe(false);

    responsePromise.resolve(undefined);
    await consumePromise;

    expect(receivedAbortSignal?.aborted).toBe(false);
  });

  it('should not arm after the call is aborted during response setup', async () => {
    const abortController = new AbortController();
    const responsePromise = new DelayedPromise<void>();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => {
          await responsePromise.promise;
          return {
            stream: convertArrayToReadableStream([
              { type: 'text-start', id: '1' },
              { type: 'text-delta', id: '1', delta: 'Hello' },
              { type: 'text-end', id: '1' },
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: testUsage,
              },
            ]),
          };
        },
      }),
      prompt: 'test-input',
      abortSignal: abortController.signal,
      timeout: { firstChunkMs: 50 },
      onError: () => {},
    });

    const consumePromise = result.consumeStream();
    abortController.abort();
    responsePromise.resolve(undefined);
    await consumePromise;

    expect(vi.getTimerCount()).toBe(0);
  });

  it('should ignore non-output parts and empty deltas', async () => {
    let receivedAbortSignal: AbortSignal | undefined;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignal = abortSignal;
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({
                  type: 'response-metadata',
                  id: 'response-id',
                });
                controller.enqueue({
                  type: 'raw',
                  rawValue: { type: 'ping' },
                });
                controller.enqueue({ type: 'text-start', id: '1' });
                controller.enqueue({
                  type: 'text-delta',
                  id: '1',
                  delta: '',
                });

                abortSignal?.addEventListener(
                  'abort',
                  () => controller.error(abortSignal.reason),
                  { once: true },
                );
              },
            }),
          };
        },
      }),
      prompt: 'test-input',
      timeout: { firstChunkMs: 50 },
      include: { rawChunks: true },
      onError: () => {},
    });

    const consumePromise = result.consumeStream();
    await vi.advanceTimersByTimeAsync(100);
    await consumePromise;

    expect(receivedAbortSignal?.aborted).toBe(true);
    expect((receivedAbortSignal?.reason as Error)?.name).toBe('TimeoutError');
    expect((receivedAbortSignal?.reason as Error)?.message).toBe(
      'First chunk timeout of 50ms exceeded',
    );
  });

  it.each<{
    name: string;
    chunks: LanguageModelV4StreamPart[];
  }>([
    {
      name: 'text delta',
      chunks: [
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: 'Hello' },
        { type: 'text-end', id: '1' },
      ],
    },
    {
      name: 'reasoning delta',
      chunks: [
        { type: 'reasoning-start', id: '1' },
        { type: 'reasoning-delta', id: '1', delta: 'Thinking' },
        { type: 'reasoning-end', id: '1' },
      ],
    },
    {
      name: 'tool input delta',
      chunks: [
        { type: 'tool-input-start', id: 'call-1', toolName: 'tool1' },
        {
          type: 'tool-input-delta',
          id: 'call-1',
          delta: '{"value":',
        },
        { type: 'tool-input-end', id: 'call-1' },
      ],
    },
    {
      name: 'tool call',
      chunks: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'tool1',
          input: '{"value":"test"}',
        },
      ],
    },
    {
      name: 'generated file',
      chunks: [
        {
          type: 'file',
          data: { type: 'data', data: 'Hello World' },
          mediaType: 'text/plain',
        },
      ],
    },
  ])('should disarm for a $name', async ({ chunks }) => {
    let receivedAbortSignal: AbortSignal | undefined;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignal = abortSignal;
          return {
            stream: convertArrayToReadableStream([
              ...chunks,
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: testUsage,
              },
            ]),
          };
        },
      }),
      tools: {
        tool1: {
          inputSchema: z.object({ value: z.string() }),
        },
      },
      prompt: 'test-input',
      timeout: { firstChunkMs: 50 },
      onError: () => {},
    });

    await result.consumeStream();
    await vi.advanceTimersByTimeAsync(100);

    expect(receivedAbortSignal?.aborted).toBe(false);
  });

  it('should clear before forwarding the first output part', async () => {
    let receivedAbortSignal: AbortSignal | undefined;
    let wasAbortedDuringOnChunk: boolean | undefined;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignal = abortSignal;
          return {
            stream: convertArrayToReadableStream([
              { type: 'text-start', id: '1' },
              { type: 'text-delta', id: '1', delta: 'Hello' },
              { type: 'text-end', id: '1' },
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: testUsage,
              },
            ]),
          };
        },
      }),
      prompt: 'test-input',
      timeout: { firstChunkMs: 50 },
      onChunk: async ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          await vi.advanceTimersByTimeAsync(100);
          wasAbortedDuringOnChunk = receivedAbortSignal?.aborted;
        }
      },
      onError: () => {},
    });

    await result.consumeStream();

    expect(wasAbortedDuringOnChunk).toBe(false);
    expect(receivedAbortSignal?.aborted).toBe(false);
  });

  it('should re-arm for later model-call steps', async () => {
    const receivedAbortSignals: (AbortSignal | undefined)[] = [];
    let stepCount = 0;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignals.push(abortSignal);
          stepCount++;

          if (stepCount === 1) {
            return {
              stream: convertArrayToReadableStream([
                {
                  type: 'tool-call',
                  toolCallId: 'call-1',
                  toolName: 'tool1',
                  input: '{"value":"test"}',
                },
                {
                  type: 'finish',
                  finishReason: {
                    unified: 'tool-calls',
                    raw: 'tool-calls',
                  },
                  usage: testUsage,
                },
              ]),
            };
          }

          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({
                  type: 'response-metadata',
                  id: 'response-id',
                });
                abortSignal?.addEventListener(
                  'abort',
                  () => controller.error(abortSignal.reason),
                  { once: true },
                );
              },
            }),
          };
        },
      }),
      tools: {
        tool1: {
          inputSchema: z.object({ value: z.string() }),
          execute: async () => 'tool result',
        },
      },
      prompt: 'test-input',
      timeout: { firstChunkMs: 50 },
      stopWhen: isStepCount(2),
      onError: () => {},
    });

    const consumePromise = result.consumeStream();
    await vi.waitFor(() => expect(stepCount).toBe(2));
    await vi.advanceTimersByTimeAsync(100);
    await consumePromise;

    expect(receivedAbortSignals).toHaveLength(2);
    expect(receivedAbortSignals[1]?.aborted).toBe(true);
    expect((receivedAbortSignals[1]?.reason as Error)?.message).toBe(
      'First chunk timeout of 50ms exceeded',
    );
  });

  it('should use chunkMs only after the first output chunk', async () => {
    let receivedAbortSignal: AbortSignal | undefined;
    const firstOutputPromise = new DelayedPromise<void>();
    const finishPromise = new DelayedPromise<void>();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignal = abortSignal;
          return {
            stream: new ReadableStream({
              async start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({
                  type: 'response-metadata',
                  id: 'response-id',
                });

                await firstOutputPromise.promise;
                controller.enqueue({ type: 'text-start', id: '1' });
                controller.enqueue({
                  type: 'text-delta',
                  id: '1',
                  delta: 'Hello',
                });

                await finishPromise.promise;
                controller.enqueue({ type: 'text-end', id: '1' });
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: 'stop' },
                  usage: testUsage,
                });
                controller.close();
              },
            }),
          };
        },
      }),
      prompt: 'test-input',
      timeout: { firstChunkMs: 100, chunkMs: 25 },
      onError: () => {},
    });

    const consumePromise = result.consumeStream();

    await vi.advanceTimersByTimeAsync(50);
    expect(receivedAbortSignal?.aborted).toBe(false);

    firstOutputPromise.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(receivedAbortSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(30);
    expect(receivedAbortSignal?.aborted).toBe(true);
    expect((receivedAbortSignal?.reason as Error)?.message).toBe(
      'Chunk timeout of 25ms exceeded',
    );

    finishPromise.resolve(undefined);
    await consumePromise;
  });
});
