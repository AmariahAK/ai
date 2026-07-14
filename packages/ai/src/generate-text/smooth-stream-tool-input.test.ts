import type { ToolSet } from '@ai-sdk/provider-utils';
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { describe, expect, it, vi } from 'vitest';
import { smoothStream } from './smooth-stream';
import type { TextStreamPart } from './stream-text-result';

async function consumeStream(
  stream: ReadableStream<TextStreamPart<ToolSet>>,
): Promise<TextStreamPart<ToolSet>[]> {
  const events: TextStreamPart<ToolSet>[] = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    events.push(value);
  }

  return events;
}

function createStream(
  chunks: TextStreamPart<ToolSet>[],
  options: Parameters<typeof smoothStream>[0],
) {
  return convertArrayToReadableStream(chunks).pipeThrough(
    smoothStream({
      ...options,
      _internal: {
        delay: options?._internal?.delay,
      },
    })({ tools: {} }),
  );
}

describe('smoothStream tool input smoothing', () => {
  it.each([null, 'word', new Intl.Segmenter('en')])(
    'rejects invalid tool input chunking: %s',
    chunking => {
      expect(() =>
        smoothStream({
          toolInputSmoothing: {
            chunking: chunking as any,
          },
        }),
      ).toThrowError();
    },
  );

  it('smooths tool input character by character when enabled', async () => {
    const delay = vi.fn(async () => {});

    const events = await consumeStream(
      createStream(
        [
          { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
          {
            type: 'tool-input-delta',
            id: 'call-1',
            delta: '{"city":"London 🌧️"}',
            providerMetadata: { testProvider: { signature: 'test' } },
          },
          { type: 'tool-input-end', id: 'call-1' },
        ],
        {
          delayInMs: 5,
          toolInputSmoothing: {},
          _internal: { delay },
        },
      ),
    );

    expect(events).toEqual([
      { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
      ...[...'{"city":"London 🌧️"}'].map((delta, index, input) => ({
        type: 'tool-input-delta' as const,
        id: 'call-1',
        delta,
        ...(index === input.length - 1
          ? {
              providerMetadata: {
                testProvider: { signature: 'test' },
              },
            }
          : {}),
      })),
      { type: 'tool-input-end', id: 'call-1' },
    ]);
    expect(delay).toHaveBeenCalledTimes([...'{"city":"London 🌧️"}'].length);
    expect(delay).toHaveBeenCalledWith(5);
  });

  it('preserves malformed partial JSON with custom chunking', async () => {
    const events = await consumeStream(
      createStream(
        [
          { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
          { type: 'tool-input-delta', id: 'call-1', delta: '{"city":' },
          { type: 'tool-input-delta', id: 'call-1', delta: '"Lon' },
          { type: 'tool-input-delta', id: 'call-1', delta: 'don"' },
          { type: 'tool-input-end', id: 'call-1' },
        ],
        {
          delayInMs: null,
          toolInputSmoothing: {
            chunking: /[:,]/,
          },
        },
      ),
    );

    expect(events).toEqual([
      { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
      { type: 'tool-input-delta', id: 'call-1', delta: '{"city":' },
      { type: 'tool-input-delta', id: 'call-1', delta: '"London"' },
      { type: 'tool-input-end', id: 'call-1' },
    ]);
    expect(
      events
        .filter(event => event.type === 'tool-input-delta')
        .map(event => event.delta)
        .join(''),
    ).toBe('{"city":"London"');
  });

  it('supports including and excluding individual tools', async () => {
    const events = await consumeStream(
      createStream(
        [
          { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
          { type: 'tool-input-delta', id: 'call-1', delta: '{"city":"Rome"}' },
          { type: 'tool-input-end', id: 'call-1' },
          { type: 'tool-input-start', id: 'call-2', toolName: 'upload' },
          { type: 'tool-input-delta', id: 'call-2', delta: '{"data":"abc"}' },
          { type: 'tool-input-end', id: 'call-2' },
          { type: 'tool-input-start', id: 'call-3', toolName: 'search' },
          { type: 'tool-input-delta', id: 'call-3', delta: '{"query":"AI"}' },
          { type: 'tool-input-end', id: 'call-3' },
        ],
        {
          delayInMs: null,
          toolInputSmoothing: {
            include: ['weather', 'upload'],
            exclude: ['upload'],
          },
        },
      ),
    );

    expect(events.filter(event => event.type === 'tool-input-delta')).toEqual([
      ...[...'{"city":"Rome"}'].map(delta => ({
        type: 'tool-input-delta',
        id: 'call-1',
        delta,
      })),
      { type: 'tool-input-delta', id: 'call-2', delta: '{"data":"abc"}' },
      { type: 'tool-input-delta', id: 'call-3', delta: '{"query":"AI"}' },
    ]);
  });

  it('preserves ordering for interleaved parallel tool calls', async () => {
    const events = await consumeStream(
      createStream(
        [
          { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
          { type: 'tool-input-start', id: 'call-2', toolName: 'search' },
          { type: 'tool-input-delta', id: 'call-1', delta: '{"city"' },
          { type: 'tool-input-delta', id: 'call-2', delta: '{"query"' },
          { type: 'tool-input-delta', id: 'call-1', delta: ':"Rome"}' },
          { type: 'tool-input-end', id: 'call-1' },
          { type: 'tool-input-delta', id: 'call-2', delta: ':"AI"}' },
          { type: 'tool-input-end', id: 'call-2' },
        ],
        {
          delayInMs: null,
          toolInputSmoothing: {
            chunking: /:/,
          },
        },
      ),
    );

    expect(events).toEqual([
      { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
      { type: 'tool-input-start', id: 'call-2', toolName: 'search' },
      { type: 'tool-input-delta', id: 'call-1', delta: '{"city"' },
      { type: 'tool-input-delta', id: 'call-2', delta: '{"query"' },
      { type: 'tool-input-delta', id: 'call-1', delta: ':' },
      { type: 'tool-input-delta', id: 'call-1', delta: '"Rome"}' },
      { type: 'tool-input-end', id: 'call-1' },
      { type: 'tool-input-delta', id: 'call-2', delta: ':' },
      { type: 'tool-input-delta', id: 'call-2', delta: '"AI"}' },
      { type: 'tool-input-end', id: 'call-2' },
    ]);
  });

  it.each([
    { type: 'error' as const, error: new Error('test') },
    { type: 'abort' as const, reason: 'test' },
  ])('flushes pending tool input before $type chunks', async finalChunk => {
    const events = await consumeStream(
      createStream(
        [
          { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
          { type: 'tool-input-delta', id: 'call-1', delta: '{"city":"Rome"' },
          finalChunk,
        ],
        {
          delayInMs: null,
          toolInputSmoothing: {
            chunking: /,missing,/,
          },
        },
      ),
    );

    expect(events).toEqual([
      { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
      { type: 'tool-input-delta', id: 'call-1', delta: '{"city":"Rome"' },
      finalChunk,
    ]);
  });

  it('flushes pending tool input when the stream closes', async () => {
    const events = await consumeStream(
      createStream(
        [
          { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
          { type: 'tool-input-delta', id: 'call-1', delta: '{"city":"Rome"' },
        ],
        {
          delayInMs: null,
          toolInputSmoothing: {
            chunking: /,missing,/,
          },
        },
      ),
    );

    expect(events).toEqual([
      { type: 'tool-input-start', id: 'call-1', toolName: 'weather' },
      { type: 'tool-input-delta', id: 'call-1', delta: '{"city":"Rome"' },
    ]);
  });
});
