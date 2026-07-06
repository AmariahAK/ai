import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createTestServer,
} from '@ai-sdk/test-server/with-vitest';
import { mockId } from '@ai-sdk/provider-utils/test';
import type { UIMessageChunk } from 'ai';
import React, { useMemo, useRef, useState } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useChat } from './use-chat';

function formatChunk(part: UIMessageChunk) {
  return `data: ${JSON.stringify(part)}\n\n`;
}

const server = createTestServer({
  '/api/chat': {},
});

describe('useChat memoized callback closures', () => {
  const onDataCounters: Array<{
    closureCounter: number;
    refCounter: number;
  }> = [];
  const onFinishCounters: Array<{
    closureCounter: number;
    refCounter: number;
  }> = [];

  function TestComponent() {
    const [counter, setCounter] = useState(0);
    const counterRef = useRef(counter);
    counterRef.current = counter;

    const chatOptions = useMemo(
      () => ({
        generateId: mockId(),
        onData: () => {
          onDataCounters.push({
            closureCounter: counter,
            refCounter: counterRef.current,
          });
        },
        onFinish: () => {
          onFinishCounters.push({
            closureCounter: counter,
            refCounter: counterRef.current,
          });
        },
      }),
      [],
    );

    const { sendMessage } = useChat(chatOptions);

    return (
      <div>
        <div data-testid="counter">{counter}</div>
        <button
          data-testid="increment"
          onClick={() => setCounter(current => current + 1)}
        />
        <button
          data-testid="send"
          onClick={() =>
            sendMessage({ parts: [{ type: 'text', text: 'Hello' }] })
          }
        />
      </div>
    );
  }

  beforeEach(() => {
    onDataCounters.length = 0;
    onFinishCounters.length = 0;

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <TestComponent />
      </SWRConfig>,
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('passes current React state to onData and onFinish when options are memoized', async () => {
    server.urls['/api/chat'].response = {
      type: 'stream-chunks',
      chunks: [
        formatChunk({ type: 'text-start', id: '0' }),
        formatChunk({ type: 'data-test', data: 'example-data' }),
        formatChunk({ type: 'text-delta', id: '0', delta: 'Hi' }),
        formatChunk({ type: 'text-end', id: '0' }),
        formatChunk({ type: 'finish', finishReason: 'stop' }),
      ],
    };

    await userEvent.click(screen.getByTestId('increment'));
    await userEvent.click(screen.getByTestId('increment'));
    await userEvent.click(screen.getByTestId('increment'));

    expect(screen.getByTestId('counter')).toHaveTextContent('3');

    await userEvent.click(screen.getByTestId('send'));

    await waitFor(() => {
      expect(onFinishCounters).toHaveLength(1);
    });

    expect({ onDataCounters, onFinishCounters }).toStrictEqual({
      onDataCounters: [{ closureCounter: 3, refCounter: 3 }],
      onFinishCounters: [{ closureCounter: 3, refCounter: 3 }],
    });
  });
});
