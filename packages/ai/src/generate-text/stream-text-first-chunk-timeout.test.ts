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

describe('streamText firstChunkMs timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts when only non-content parts arrive before the deadline', async () => {
    let receivedAbortSignal: AbortSignal | undefined;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignal = abortSignal;

          return {
            stream: new ReadableStream({
              start(controller) {
                abortSignal?.addEventListener(
                  'abort',
                  () => controller.error(abortSignal.reason),
                  { once: true },
                );

                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({
                  type: 'response-metadata',
                  id: 'response-id',
                });
                controller.enqueue({ type: 'raw', rawValue: ': ping' });
                controller.enqueue({ type: 'text-start', id: '1' });
                controller.enqueue({
                  type: 'text-delta',
                  id: '1',
                  delta: '',
                });
              },
            }),
          };
        },
      }),
      prompt: 'test-input',
      timeout: { firstChunkMs: 50 },
      onError: () => {},
    });

    const textExpectation = expect(result.text).rejects.toHaveProperty(
      'name',
      'TimeoutError',
    );
    await vi.advanceTimersByTimeAsync(100);

    await textExpectation;
    expect(receivedAbortSignal?.aborted).toBe(true);
    expect((receivedAbortSignal!.reason as Error).message).toBe(
      'First chunk timeout of 50ms exceeded',
    );
  });

  it.each([
    {
      name: 'text delta',
      chunks: [
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: 'Hello' },
      ] satisfies LanguageModelV4StreamPart[],
    },
    {
      name: 'reasoning delta',
      chunks: [
        { type: 'reasoning-start', id: '1' },
        { type: 'reasoning-delta', id: '1', delta: 'Thinking' },
      ] satisfies LanguageModelV4StreamPart[],
    },
    {
      name: 'tool input delta',
      chunks: [
        {
          type: 'tool-input-start',
          id: 'call-1',
          toolName: 'tool1',
        },
        {
          type: 'tool-input-delta',
          id: 'call-1',
          delta: '{"value":"test"}',
        },
      ] satisfies LanguageModelV4StreamPart[],
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
      ] satisfies LanguageModelV4StreamPart[],
    },
  ])('disarms before forwarding the first $name', async ({ chunks }) => {
    let receivedAbortSignal: AbortSignal | undefined;
    const continueStream = new DelayedPromise<void>();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignal = abortSignal;

          return {
            stream: new ReadableStream({
              async start(controller) {
                for (const chunk of chunks) {
                  controller.enqueue(chunk);
                }

                await continueStream.promise;
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
      tools: {
        tool1: {
          inputSchema: z.object({ value: z.string() }),
        },
      },
      prompt: 'test-input',
      timeout: { firstChunkMs: 50 },
      onError: () => {},
    });

    const consumePromise = result.consumeStream();
    await vi.advanceTimersByTimeAsync(100);

    expect(receivedAbortSignal?.aborted).toBe(false);

    continueStream.resolve(undefined);
    await consumePromise;
  });

  it('re-arms the deadline for later model-call steps', async () => {
    const receivedAbortSignals: AbortSignal[] = [];
    let stepCount = 0;

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignals.push(abortSignal!);
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
                  finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
                  usage: testUsage,
                },
              ]),
            };
          }

          return {
            stream: new ReadableStream({
              start(controller) {
                abortSignal?.addEventListener(
                  'abort',
                  () => controller.error(abortSignal.reason),
                  { once: true },
                );
                controller.enqueue({
                  type: 'response-metadata',
                  id: 'second-step',
                });
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
    expect(receivedAbortSignals[1].aborted).toBe(true);
    expect((receivedAbortSignals[1].reason as Error).name).toBe('TimeoutError');
  });

  it('starts chunkMs only after the first content-bearing output', async () => {
    let receivedAbortSignal: AbortSignal | undefined;
    const sendFirstOutput = new DelayedPromise<void>();

    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          receivedAbortSignal = abortSignal;

          return {
            stream: new ReadableStream({
              async start(controller) {
                abortSignal?.addEventListener(
                  'abort',
                  () => controller.error(abortSignal.reason),
                  { once: true },
                );
                controller.enqueue({
                  type: 'response-metadata',
                  id: 'response-id',
                });

                await sendFirstOutput.promise;

                controller.enqueue({ type: 'text-start', id: '1' });
                controller.enqueue({
                  type: 'text-delta',
                  id: '1',
                  delta: 'Hello',
                });
              },
            }),
          };
        },
      }),
      prompt: 'test-input',
      timeout: { firstChunkMs: 100, chunkMs: 20 },
      onError: () => {},
    });

    const consumePromise = result.consumeStream();

    await vi.advanceTimersByTimeAsync(50);
    expect(receivedAbortSignal?.aborted).toBe(false);

    sendFirstOutput.resolve(undefined);
    await vi.advanceTimersByTimeAsync(30);
    await consumePromise;

    expect(receivedAbortSignal?.aborted).toBe(true);
    expect((receivedAbortSignal!.reason as Error).message).toBe(
      'Chunk timeout of 20ms exceeded',
    );
  });
});
