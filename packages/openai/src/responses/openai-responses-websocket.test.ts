import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIResponsesWebSocketManager } from './openai-responses-websocket';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readyState = 0;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.({});
  });
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(
    readonly url: string | URL,
    readonly protocols?: string | string[],
    readonly options?: { headers?: Record<string, string | undefined> },
  ) {
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

const completedResponse = (id: string) => ({
  type: 'response.completed' as const,
  response: {
    id,
    incomplete_details: null,
    usage: {
      input_tokens: 1,
      input_tokens_details: null,
      output_tokens: 1,
      output_tokens_details: null,
    },
    service_tier: null,
  },
});

function createManager(): OpenAIResponsesWebSocketManager {
  return new OpenAIResponsesWebSocketManager(MockWebSocket);
}

async function startRequest({
  manager,
  continuation,
  body = { model: 'gpt-5', input: [{ role: 'user', content: 'hello' }] },
  abortSignal,
}: {
  manager: OpenAIResponsesWebSocketManager;
  continuation?: { toolCallIds: string[]; input: unknown[] };
  body?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}) {
  const instanceCount = MockWebSocket.instances.length;
  const requestPromise = manager.request({
    url: 'https://api.openai.com/v1/responses',
    headers: { Authorization: 'Bearer test-key' },
    body,
    continuation,
    abortSignal,
  });

  const socket = MockWebSocket.instances.at(-1);
  if (socket == null) throw new Error('Expected a WebSocket instance.');
  if (MockWebSocket.instances.length > instanceCount) socket.open();

  return { request: await requestPromise, socket };
}

afterEach(() => {
  MockWebSocket.instances = [];
});

describe('OpenAIResponsesWebSocketManager', () => {
  it('sends a response.create frame and closes after the final response', async () => {
    const { request, socket } = await startRequest({
      manager: createManager(),
      body: {
        model: 'gpt-5',
        input: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(socket.url.toString()).toBe('wss://api.openai.com/v1/responses');
    expect(socket.options).toEqual({
      headers: { Authorization: 'Bearer test-key' },
    });
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
      type: 'response.create',
      model: 'gpt-5',
      input: [{ role: 'user', content: 'hello' }],
    });

    const chunksPromise = convertReadableStreamToArray(request.stream);
    socket.message(completedResponse('resp-final'));
    await expect(chunksPromise).resolves.toHaveLength(1);

    request.finish([]);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('reuses the socket only for a matching tool-result continuation', async () => {
    const manager = createManager();
    const firstInput = [{ role: 'user', content: 'hello' }];
    const first = await startRequest({
      manager,
      body: { model: 'gpt-5', input: firstInput },
    });
    const firstChunks = convertReadableStreamToArray(first.request.stream);
    first.socket.message(completedResponse('resp-1'));
    await firstChunks;
    first.request.finish(['call-1']);

    const toolOutput = {
      type: 'function_call_output',
      call_id: 'call-1',
      output: 'result',
    };
    const second = await startRequest({
      manager,
      continuation: { toolCallIds: ['call-1'], input: [toolOutput] },
      body: {
        model: 'gpt-5',
        input: [
          ...firstInput,
          { type: 'function_call', call_id: 'call-1' },
          toolOutput,
        ],
      },
    });

    expect(second.socket).toBe(first.socket);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(JSON.parse(first.socket.send.mock.calls[1][0])).toEqual({
      type: 'response.create',
      model: 'gpt-5',
      previous_response_id: 'resp-1',
      input: [toolOutput],
    });

    const secondChunks = convertReadableStreamToArray(second.request.stream);
    second.socket.message(completedResponse('resp-2'));
    await secondChunks;
    second.request.finish([]);
    expect(first.socket.close).toHaveBeenCalledOnce();
  });

  it('opens a new socket with full input when the prompt is not a continuation', async () => {
    const manager = createManager();
    const first = await startRequest({ manager });
    const firstChunks = convertReadableStreamToArray(first.request.stream);
    first.socket.message(completedResponse('resp-1'));
    await firstChunks;
    first.request.finish(['call-1']);

    const replacementInput = [
      { role: 'user', content: 'this is a different prompt' },
    ];
    const second = await startRequest({
      manager,
      continuation: {
        toolCallIds: ['call-1'],
        input: [
          {
            type: 'function_call_output',
            call_id: 'call-1',
            output: 'result',
          },
        ],
      },
      body: { model: 'gpt-5', input: replacementInput },
    });

    expect(second.socket).not.toBe(first.socket);
    expect(first.socket.close).toHaveBeenCalledOnce();
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(JSON.parse(second.socket.send.mock.calls[0][0])).toEqual({
      type: 'response.create',
      model: 'gpt-5',
      input: replacementInput,
    });

    const secondChunks = convertReadableStreamToArray(second.request.stream);
    second.socket.message(completedResponse('resp-2'));
    await secondChunks;
    second.request.finish([]);
  });

  it('continues conversations without adding previous_response_id', async () => {
    const manager = createManager();
    const firstInput = [{ role: 'user', content: 'hello' }];
    const first = await startRequest({
      manager,
      body: {
        model: 'gpt-5',
        conversation: 'conv-1',
        input: firstInput,
      },
    });
    const firstChunks = convertReadableStreamToArray(first.request.stream);
    first.socket.message(completedResponse('resp-1'));
    await firstChunks;
    first.request.finish(['call-1']);

    const toolOutput = {
      type: 'function_call_output',
      call_id: 'call-1',
      output: 'result',
    };
    const second = await startRequest({
      manager,
      continuation: { toolCallIds: ['call-1'], input: [toolOutput] },
      body: {
        model: 'gpt-5',
        conversation: 'conv-1',
        input: [
          ...firstInput,
          { type: 'function_call', call_id: 'call-1' },
          toolOutput,
        ],
      },
    });

    expect(second.socket).toBe(first.socket);
    expect(JSON.parse(first.socket.send.mock.calls[1][0])).toEqual({
      type: 'response.create',
      model: 'gpt-5',
      conversation: 'conv-1',
      input: [toolOutput],
    });

    const secondChunks = convertReadableStreamToArray(second.request.stream);
    second.socket.message(completedResponse('resp-2'));
    await secondChunks;
    second.request.finish([]);
  });

  it('uses separate sockets for unrelated high-level turns', async () => {
    const abortController = new AbortController();
    const manager = createManager();
    const first = await startRequest({
      manager,
      abortSignal: abortController.signal,
    });
    const firstChunks = convertReadableStreamToArray(first.request.stream);
    first.socket.message(completedResponse('resp-1'));
    await firstChunks;
    first.request.finish(['call-1']);

    const unrelated = await startRequest({ manager });
    expect(unrelated.socket).not.toBe(first.socket);
    expect(MockWebSocket.instances).toHaveLength(2);

    const unrelatedChunks = convertReadableStreamToArray(
      unrelated.request.stream,
    );
    unrelated.socket.message(completedResponse('resp-unrelated'));
    await unrelatedChunks;
    unrelated.request.finish([]);

    expect(first.socket.close).not.toHaveBeenCalled();
    abortController.abort();
    expect(first.socket.close).toHaveBeenCalledOnce();
  });

  it('waits indefinitely for a matching continuation until aborted', async () => {
    const abortController = new AbortController();
    const first = await startRequest({
      manager: createManager(),
      abortSignal: abortController.signal,
    });
    const chunks = convertReadableStreamToArray(first.request.stream);
    first.socket.message(completedResponse('resp-1'));
    await chunks;
    first.request.finish(['call-1']);

    expect(first.socket.close).not.toHaveBeenCalled();
    abortController.abort();
    expect(first.socket.close).toHaveBeenCalledOnce();
  });

  it('closes on abort after a terminal event even before finish is called', async () => {
    const abortController = new AbortController();
    const request = await startRequest({
      manager: createManager(),
      abortSignal: abortController.signal,
    });
    const chunks = convertReadableStreamToArray(request.request.stream);
    request.socket.message(completedResponse('resp-1'));
    await chunks;

    expect(request.socket.close).not.toHaveBeenCalled();
    abortController.abort();
    expect(request.socket.close).toHaveBeenCalledOnce();
  });

  it('closes on cancellation', async () => {
    const { request, socket } = await startRequest({
      manager: createManager(),
    });

    await request.stream.cancel();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
