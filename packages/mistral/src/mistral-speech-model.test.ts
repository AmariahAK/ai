import { APICallError, InvalidArgumentError } from '@ai-sdk/provider';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { describe, expect, it, vi } from 'vitest';
import { createMistral } from './mistral-provider';
import { MistralSpeechModel } from './mistral-speech-model';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

const SPEECH_URL = 'https://api.mistral.ai/v1/audio/speech';
const provider = createMistral({ apiKey: 'test-api-key' });
const model = provider.speech('voxtral-mini-tts-2603');

const server = createTestServer({
  [SPEECH_URL]: {},
});

describe('MistralSpeechModel', () => {
  function prepareJsonResponse({
    audioData = 'AQIDBA==',
    headers,
  }: {
    audioData?: string;
    headers?: Record<string, string>;
  } = {}) {
    server.urls[SPEECH_URL].response = {
      type: 'json-value',
      headers,
      body: {
        audio_data: audioData,
      },
    };
  }

  it('should expose correct provider and model information', () => {
    expect(model.provider).toBe('mistral.speech');
    expect(model.modelId).toBe('voxtral-mini-tts-2603');
    expect(model.specificationVersion).toBe('v4');
  });

  it('should create speech models with both provider factories', () => {
    expect(provider.speech('voxtral-mini-tts-2603')).toBeInstanceOf(
      MistralSpeechModel,
    );
    expect(provider.speechModel('voxtral-mini-tts-2603')).toBeInstanceOf(
      MistralSpeechModel,
    );
  });

  it('should send text with non-streaming defaults', async () => {
    prepareJsonResponse();

    await model.doGenerate({
      text: 'Hello from the AI SDK!',
      voice: 'en_paul_neutral',
    });

    expect(await server.calls[0].requestBodyJson).toStrictEqual({
      model: 'voxtral-mini-tts-2603',
      input: 'Hello from the AI SDK!',
      voice_id: 'en_paul_neutral',
      response_format: 'mp3',
      stream: false,
    });
    expect(server.calls[0].requestMethod).toBe('POST');
    expect(server.calls[0].requestUrl).toBe(SPEECH_URL);
  });

  it('should map voice to voice_id', async () => {
    prepareJsonResponse();

    await model.doGenerate({
      text: 'Hello from the AI SDK!',
      voice: 'preset-or-custom-voice-id',
    });

    expect(await server.calls[0].requestBodyJson).toMatchObject({
      voice_id: 'preset-or-custom-voice-id',
    });
  });

  it.each(['pcm', 'wav', 'mp3', 'flac', 'opus'])(
    'should accept the %s output format',
    async outputFormat => {
      prepareJsonResponse();

      await model.doGenerate({
        text: 'Hello from the AI SDK!',
        voice: 'en_paul_neutral',
        outputFormat,
      });

      expect(await server.calls[0].requestBodyJson).toMatchObject({
        response_format: outputFormat,
      });
    },
  );

  it('should warn and use mp3 for unsupported output formats', async () => {
    prepareJsonResponse();

    const result = await model.doGenerate({
      text: 'Hello from the AI SDK!',
      voice: 'en_paul_neutral',
      outputFormat: 'aac',
    });

    expect(await server.calls[0].requestBodyJson).toMatchObject({
      response_format: 'mp3',
    });
    expect(result.warnings).toContainEqual({
      type: 'unsupported',
      feature: 'outputFormat',
      details: 'Unsupported output format: aac. Using mp3 instead.',
    });
  });

  it('should map refAudio and redact it from request metadata', async () => {
    prepareJsonResponse();
    const refAudio = 'c2Vuc2l0aXZlLXZvaWNlLXNhbXBsZQ==';

    const result = await model.doGenerate({
      text: 'Hello from the AI SDK!',
      providerOptions: {
        mistral: {
          refAudio,
        },
      },
    });

    expect(await server.calls[0].requestBodyJson).toMatchObject({
      ref_audio: refAudio,
    });
    expect(result.request?.body).toMatchObject({
      ref_audio: '[base64 audio redacted]',
    });
    expect(JSON.stringify(result.request)).not.toContain(refAudio);
  });

  it('should reject voice and refAudio when used together', async () => {
    await expect(
      model.doGenerate({
        text: 'Hello from the AI SDK!',
        voice: 'voice-id',
        providerOptions: {
          mistral: {
            refAudio: 'c2FtcGxl',
          },
        },
      }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('should require either voice or refAudio', async () => {
    await expect(
      model.doGenerate({
        text: 'Hello from the AI SDK!',
      }),
    ).rejects.toMatchObject({
      name: 'AI_InvalidArgumentError',
      argument: 'voice',
    });
  });

  it('should warn for unsupported standard speech options', async () => {
    prepareJsonResponse();

    const result = await model.doGenerate({
      text: 'Hello from the AI SDK!',
      voice: 'en_paul_neutral',
      instructions: 'Speak cheerfully.',
      speed: 1.25,
      language: 'en',
    });

    expect(result.warnings).toEqual([
      expect.objectContaining({
        type: 'unsupported',
        feature: 'instructions',
      }),
      expect.objectContaining({
        type: 'unsupported',
        feature: 'speed',
      }),
      expect.objectContaining({
        type: 'unsupported',
        feature: 'language',
      }),
    ]);
  });

  it('should return base64 audio data', async () => {
    prepareJsonResponse({ audioData: 'AQIDBA==' });

    const result = await model.doGenerate({
      text: 'Hello from the AI SDK!',
      voice: 'en_paul_neutral',
    });

    expect(result.audio).toBe('AQIDBA==');
    expect(result.warnings).toEqual([]);
  });

  it('should include response timestamp, model id, headers, and body', async () => {
    prepareJsonResponse({
      headers: { 'x-request-id': 'test-request-id' },
    });
    const testDate = new Date(0);
    const customModel = new MistralSpeechModel('voxtral-mini-tts-2603', {
      provider: 'mistral.speech',
      baseURL: 'https://api.mistral.ai/v1',
      headers: () => ({ Authorization: 'Bearer test-api-key' }),
      _internal: { currentDate: () => testDate },
    });

    const result = await customModel.doGenerate({
      text: 'Hello from the AI SDK!',
      voice: 'en_paul_neutral',
    });

    expect(result.response).toMatchObject({
      timestamp: testDate,
      modelId: 'voxtral-mini-tts-2603',
      headers: expect.objectContaining({
        'x-request-id': 'test-request-id',
      }),
      body: { audio_data: 'AQIDBA==' },
    });
  });

  it('should pass provider and request headers', async () => {
    prepareJsonResponse();
    const customProvider = createMistral({
      apiKey: 'test-api-key',
      headers: {
        'Custom-Provider-Header': 'provider-header-value',
      },
    });

    await customProvider.speech('voxtral-mini-tts-2603').doGenerate({
      text: 'Hello from the AI SDK!',
      voice: 'en_paul_neutral',
      headers: {
        'Custom-Request-Header': 'request-header-value',
      },
    });

    expect(server.calls[0].requestHeaders).toMatchObject({
      authorization: 'Bearer test-api-key',
      'content-type': 'application/json',
      'custom-provider-header': 'provider-header-value',
      'custom-request-header': 'request-header-value',
    });
    expect(server.calls[0].requestUserAgent).toContain(
      'ai-sdk/mistral/0.0.0-test',
    );
  });

  it('should use a custom base URL and fetch implementation', async () => {
    const customFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(JSON.stringify({ audio_data: 'AQIDBA==' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    );
    const customProvider = createMistral({
      apiKey: 'test-api-key',
      baseURL: 'https://custom.mistral.test/v1/',
      fetch: customFetch,
    });

    await customProvider.speech('voxtral-mini-tts-2603').doGenerate({
      text: 'Hello from the AI SDK!',
      voice: 'en_paul_neutral',
    });

    expect(customFetch).toHaveBeenCalledOnce();
    expect(customFetch.mock.calls[0][0]).toBe(
      'https://custom.mistral.test/v1/audio/speech',
    );
  });

  it('should forward the abort signal', async () => {
    const abortController = new AbortController();
    const customFetch = vi.fn(async (_input, init) => {
      expect(init?.signal).toBe(abortController.signal);
      return new Response(JSON.stringify({ audio_data: 'AQIDBA==' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const customProvider = createMistral({
      apiKey: 'test-api-key',
      fetch: customFetch,
    });

    await customProvider.speech('voxtral-mini-tts-2603').doGenerate({
      text: 'Hello from the AI SDK!',
      voice: 'en_paul_neutral',
      abortSignal: abortController.signal,
    });

    expect(customFetch).toHaveBeenCalledOnce();
  });

  it('should handle moderation errors without exposing refAudio', async () => {
    server.urls[SPEECH_URL].response = {
      type: 'error',
      status: 400,
      body: JSON.stringify({
        object: 'error',
        message: 'The request was rejected by voice safety moderation.',
        type: 'moderation_error',
        param: 'ref_audio',
        code: 'voice_safety_rejection',
      }),
    };
    const refAudio = 'c2Vuc2l0aXZlLXZvaWNlLXNhbXBsZQ==';

    let error: unknown;
    try {
      await model.doGenerate({
        text: 'Hello from the AI SDK!',
        providerOptions: {
          mistral: {
            refAudio,
          },
        },
      });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(APICallError);
    if (!APICallError.isInstance(error)) {
      throw new Error('Expected an APICallError.');
    }
    expect(error).toMatchObject({
      message: 'The request was rejected by voice safety moderation.',
      statusCode: 400,
      requestBodyValues: {
        ref_audio: '[base64 audio redacted]',
      },
    });
    expect(JSON.stringify(error.requestBodyValues)).not.toContain(refAudio);
  });
});
