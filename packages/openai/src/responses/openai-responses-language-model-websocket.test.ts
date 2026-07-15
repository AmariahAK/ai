import type {
  LanguageModelV4FunctionTool,
  LanguageModelV4Prompt,
} from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIResponsesLanguageModel } from './openai-responses-language-model';

const prompt: LanguageModelV4Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
];

const weatherTool: LanguageModelV4FunctionTool = {
  type: 'function',
  name: 'weather',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

const response = {
  id: 'resp-1',
  created_at: 1_700_000_000,
  error: null,
  model: 'gpt-5',
  output: [
    {
      type: 'message',
      role: 'assistant',
      id: 'msg-1',
      phase: 'final_answer',
      content: [
        {
          type: 'output_text',
          text: 'Hello!',
          logprobs: null,
          annotations: [],
        },
      ],
    },
  ],
  service_tier: 'default',
  incomplete_details: null,
  usage: {
    input_tokens: 2,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
  },
};

class AutoResponseWebSocket {
  static instances: AutoResponseWebSocket[] = [];
  static frames: unknown[] = [];

  readyState = 0;
  send = vi.fn<(data: string | Uint8Array | ArrayBuffer) => void>(() => {
    for (const frame of AutoResponseWebSocket.frames) {
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(frame) }));
    }
  });
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
    AutoResponseWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }
}

function createModel(): OpenAIResponsesLanguageModel {
  return new OpenAIResponsesLanguageModel('gpt-5', {
    provider: 'openai.responses',
    url: ({ path }) => `https://api.openai.com/v1${path}`,
    headers: () => ({ Authorization: 'Bearer test-key' }),
    webSocket: AutoResponseWebSocket,
  });
}

afterEach(() => {
  AutoResponseWebSocket.instances = [];
  AutoResponseWebSocket.frames = [];
});

describe('OpenAIResponsesLanguageModel WebSocket transport', () => {
  it('buffers WebSocket events for doGenerate without changing its result shape', async () => {
    AutoResponseWebSocket.frames = [{ type: 'response.completed', response }];

    const result = await createModel().doGenerate({
      prompt,
      providerOptions: { openai: { transport: 'websocket' } },
    });

    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Hello!',
        providerMetadata: {
          openai: { itemId: 'msg-1', phase: 'final_answer' },
        },
      },
    ]);
    expect(result.response).toMatchObject({
      id: 'resp-1',
      modelId: 'gpt-5',
      headers: undefined,
      body: response,
    });
    expect(AutoResponseWebSocket.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it('maps WebSocket error events to the existing APICallError shape', async () => {
    AutoResponseWebSocket.frames = [
      {
        type: 'error',
        status: 400,
        error: {
          code: 'previous_response_not_found',
          message: "Previous response with id 'resp-missing' not found.",
          param: 'previous_response_id',
        },
      },
    ];

    await expect(
      createModel().doGenerate({
        prompt,
        providerOptions: { openai: { transport: 'websocket' } },
      }),
    ).rejects.toMatchObject({
      name: 'AI_APICallError',
      message: "Previous response with id 'resp-missing' not found.",
      statusCode: 400,
      isRetryable: false,
    });

    expect(AutoResponseWebSocket.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it('maps WebSocket events through the existing doStream result shape', async () => {
    AutoResponseWebSocket.frames = [
      {
        type: 'response.created',
        response: {
          id: 'resp-1',
          created_at: 1_700_000_000,
          model: 'gpt-5',
          service_tier: 'default',
        },
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg-1',
        delta: 'Hello!',
        logprobs: null,
      },
      { type: 'response.completed', response },
    ];

    const result = await createModel().doStream({
      prompt,
      providerOptions: { openai: { transport: 'websocket' } },
    });
    const parts = await convertReadableStreamToArray(result.stream);

    expect(parts).toContainEqual({
      type: 'text-delta',
      id: 'msg-1',
      delta: 'Hello!',
    });
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
      }),
    );
    expect(result.response).toEqual({ headers: undefined });
    expect(AutoResponseWebSocket.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it('continues a tool step on the same socket with only the new tool output', async () => {
    const model = createModel();
    AutoResponseWebSocket.frames = [
      {
        type: 'response.completed',
        response: {
          ...response,
          id: 'resp-tool-call',
          output: [
            {
              type: 'function_call',
              id: 'fc-1',
              call_id: 'call-1',
              name: 'weather',
              arguments: '{}',
            },
          ],
        },
      },
    ];

    await model.doGenerate({
      prompt,
      tools: [weatherTool],
      providerOptions: { openai: { transport: 'websocket' } },
    });

    const socket = AutoResponseWebSocket.instances[0]!;
    expect(socket.close).not.toHaveBeenCalled();

    AutoResponseWebSocket.frames = [
      {
        type: 'response.completed',
        response: { ...response, id: 'resp-final' },
      },
    ];

    await model.doGenerate({
      prompt: [
        ...prompt,
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'weather',
              input: {},
              providerOptions: { openai: { itemId: 'fc-1' } },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'weather',
              output: { type: 'text', value: 'sunny' },
            },
          ],
        },
      ],
      tools: [weatherTool],
      providerOptions: { openai: { transport: 'websocket' } },
    });

    expect(AutoResponseWebSocket.instances).toHaveLength(1);
    const continuationFrame = socket.send.mock.calls[1]?.[0];
    if (typeof continuationFrame !== 'string') {
      throw new Error('Expected a JSON WebSocket frame.');
    }
    expect(JSON.parse(continuationFrame)).toMatchObject({
      type: 'response.create',
      previous_response_id: 'resp-tool-call',
      input: [
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: 'sunny',
        },
      ],
    });
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
