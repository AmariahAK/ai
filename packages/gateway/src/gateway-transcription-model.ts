import type {
  Experimental_TranscriptionModelV4StreamOptions as TranscriptionModelV4StreamOptions,
  Experimental_TranscriptionModelV4StreamPart as TranscriptionModelV4StreamPart,
  Experimental_TranscriptionModelV4StreamResult as TranscriptionModelV4StreamResult,
  SharedV4ProviderMetadata,
  SharedV4Warning,
  TranscriptionModelV4,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  convertBase64ToUint8Array,
  convertUint8ArrayToBase64,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  getWebSocketConstructor,
  postJsonToApi,
  readWebSocketMessageText,
  resolve,
  safeParseJSON,
  type Resolvable,
  type WebSocketConstructor,
  type WebSocketLike,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { asGatewayError } from './errors';
import { parseAuthMethod } from './errors/parse-auth-method';
import type { GatewayConfig } from './gateway-config';
import { VERCEL_AI_GATEWAY_TEAM_HEADER } from './gateway-headers';
import {
  GATEWAY_TRANSCRIPTION_SUBPROTOCOL,
  getGatewayTranscriptionProtocols,
} from './gateway-realtime-auth';

export class GatewayTranscriptionModel implements TranscriptionModelV4 {
  readonly specificationVersion = 'v4' as const;

  constructor(
    readonly modelId: string,
    private readonly config: GatewayConfig & {
      provider: string;
      o11yHeaders: Resolvable<Record<string, string>>;
      _internal?: {
        currentDate?: () => Date;
      };
    },
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate({
    audio,
    mediaType,
    providerOptions,
    headers,
    abortSignal,
  }: Parameters<TranscriptionModelV4['doGenerate']>[0]): Promise<
    Awaited<ReturnType<TranscriptionModelV4['doGenerate']>>
  > {
    const resolvedHeaders = this.config.headers
      ? await resolve(this.config.headers)
      : undefined;
    try {
      const {
        responseHeaders,
        value: responseBody,
        rawValue,
      } = await postJsonToApi({
        url: this.getUrl(),
        headers: combineHeaders(
          resolvedHeaders,
          headers ?? {},
          this.getModelConfigHeaders(),
          await resolve(this.config.o11yHeaders),
        ),
        body: {
          audio:
            audio instanceof Uint8Array
              ? convertUint8ArrayToBase64(audio)
              : audio,
          mediaType,
          ...(providerOptions && { providerOptions }),
        },
        successfulResponseHandler: createJsonResponseHandler(
          gatewayTranscriptionResponseSchema,
        ),
        failedResponseHandler: createJsonErrorResponseHandler({
          errorSchema: z.any(),
          errorToMessage: data => data,
        }),
        ...(abortSignal && { abortSignal }),
        fetch: this.config.fetch,
      });

      return {
        text: responseBody.text,
        segments: responseBody.segments ?? [],
        language: responseBody.language ?? undefined,
        durationInSeconds: responseBody.durationInSeconds ?? undefined,
        warnings: (responseBody.warnings ?? []) as Array<SharedV4Warning>,
        providerMetadata:
          responseBody.providerMetadata as SharedV4ProviderMetadata,
        response: {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: responseHeaders,
          body: rawValue,
        },
      };
    } catch (error) {
      throw await asGatewayError(
        error,
        await parseAuthMethod(resolvedHeaders ?? {}),
      );
    }
  }

  async doStream(
    options: TranscriptionModelV4StreamOptions,
  ): Promise<TranscriptionModelV4StreamResult> {
    const currentDate = this.config._internal?.currentDate?.() ?? new Date();

    const headers = combineHeaders(
      await resolve(this.config.headers ?? {}),
      options.headers ?? {},
      this.getModelConfigHeaders(),
      await resolve(this.config.o11yHeaders),
    );
    const authMethod = await parseAuthMethod(headers);

    // The session start frame is the first frame sent after the WebSocket
    // opens. Optional keys are omitted (not sent as `undefined`/`null`) so the
    // serialized frame stays minimal and unambiguous.
    const startFrame = {
      type: 'transcription-session.start' as const,
      inputAudioFormat: options.inputAudioFormat,
      ...(options.providerOptions != null && {
        providerOptions: options.providerOptions,
      }),
      ...(options.includeRawChunks != null && {
        includeRawChunks: options.includeRawChunks,
      }),
    };

    return {
      stream: createGatewayTranscriptionStream({
        webSocket: this.config.webSocket,
        url: toGatewayTranscriptionUrl(this.config.baseURL, this.modelId),
        protocols: getProtocolsFromHeaders(headers),
        headers,
        startFrame,
        audio: options.audio,
        abortSignal: options.abortSignal,
        authMethod,
      }),
      request: { body: startFrame },
      response: { timestamp: currentDate, modelId: this.modelId },
    };
  }

  private getUrl() {
    return `${this.config.baseURL}/transcription-model`;
  }

  private getModelConfigHeaders() {
    return {
      'ai-transcription-model-specification-version': '4',
      'ai-model-id': this.modelId,
    };
  }
}

/**
 * Build the Gateway streaming transcription WebSocket URL. The HTTP(S) base URL
 * is upgraded to WS(S) and the model id rides the `?ai-model-id=` query — the
 * WS transport of the `ai-model-id` header the HTTP routes use, since a browser
 * `WebSocket` cannot set headers. The query is slash-safe for qualified ids
 * such as `openai/gpt-realtime-whisper`.
 */
function toGatewayTranscriptionUrl(baseURL: string, modelId: string): string {
  const url = new URL(`${baseURL.replace(/^http/, 'ws')}/transcription-model`);
  url.searchParams.set('ai-model-id', modelId);
  return url.toString();
}

/**
 * Derive the auth-carrying WebSocket subprotocols from the resolved request
 * headers: the bearer token from `Authorization` and the optional team scope
 * from `x-vercel-ai-gateway-team`. Native `WebSocket` cannot send headers, so
 * auth rides the `Sec-WebSocket-Protocol` handshake instead.
 */
function getProtocolsFromHeaders(
  headers: Record<string, string | undefined>,
): string[] {
  const authorization = headers.Authorization ?? headers.authorization;
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined;

  return token == null
    ? [GATEWAY_TRANSCRIPTION_SUBPROTOCOL]
    : getGatewayTranscriptionProtocols(token, {
        teamIdOrSlug: headers[VERCEL_AI_GATEWAY_TEAM_HEADER],
      });
}

function createGatewayTranscriptionStream({
  webSocket,
  url,
  protocols,
  headers,
  startFrame,
  audio,
  abortSignal,
  authMethod,
}: {
  webSocket: WebSocketConstructor | undefined;
  url: string;
  protocols: string[];
  headers: Record<string, string | undefined>;
  startFrame: unknown;
  audio: ReadableStream<Uint8Array | string>;
  abortSignal: AbortSignal | undefined;
  authMethod: 'api-key' | 'oidc' | undefined;
}): ReadableStream<TranscriptionModelV4StreamPart> {
  let finished = false;
  let cleanup: (closeCode?: number) => void = () => {};

  return new ReadableStream<TranscriptionModelV4StreamPart>({
    start: controller => {
      let ws: WebSocketLike | undefined;
      let audioReader:
        | ReadableStreamDefaultReader<Uint8Array | string>
        | undefined;

      cleanup = (closeCode?: number) => {
        abortSignal?.removeEventListener('abort', abort);
        void audioReader?.cancel().catch(() => {});
        try {
          ws?.close(closeCode);
        } catch {}
      };

      const finishWithError = (error: unknown) => {
        if (finished) return;
        finished = true;
        cleanup();
        void errorControllerWithGatewayError(controller, error, authMethod);
      };

      const abort = () => {
        if (finished) return;
        finished = true;
        cleanup();
        controller.error(abortSignal?.reason ?? new Error('Aborted'));
      };

      if (abortSignal?.aborted) {
        abort();
        return;
      }
      abortSignal?.addEventListener('abort', abort, { once: true });

      let socket: WebSocketLike;
      try {
        const WebSocketConstructor = getWebSocketConstructor(webSocket);
        // Headers cannot be sent by native `WebSocket` implementations (auth
        // rides the subprotocols instead), but header-capable implementations
        // like the `ws` package forward them.
        socket = new WebSocketConstructor(url, protocols, { headers });
      } catch (error) {
        finishWithError(error);
        return;
      }
      ws = socket;

      const sendAudio = async () => {
        audioReader = audio.getReader();
        try {
          while (true) {
            const { done, value } = await audioReader.read();
            if (done || finished) break;
            // Audio is sent as binary WebSocket frames; base64 string chunks
            // are decoded to raw bytes first.
            socket.send(
              typeof value === 'string'
                ? convertBase64ToUint8Array(value)
                : value,
            );
          }
        } finally {
          audioReader.releaseLock();
        }
        if (!finished) {
          socket.send(
            JSON.stringify({ type: 'transcription-session.audio-done' }),
          );
        }
      };

      socket.onopen = () => {
        socket.send(JSON.stringify(startFrame));
        void sendAudio().catch(finishWithError);
      };

      // The Gateway emits normalized AI SDK transcription stream parts, so
      // each text frame is relayed as-is; only `response-metadata` needs its
      // `timestamp` revived from the ISO string JSON serialization.
      socket.onmessage = event => {
        void readWebSocketMessageText(event.data)
          .then(async text => {
            if (finished) return;
            const parsed = await safeParseJSON({ text });
            if (!parsed.success) return;
            const part = parsed.value as TranscriptionModelV4StreamPart;

            switch (part.type) {
              case 'error':
              case 'raw':
              case 'stream-start':
              case 'transcript-delta':
              case 'transcript-final':
              case 'transcript-partial':
                controller.enqueue(part);
                break;

              case 'response-metadata':
                controller.enqueue({
                  ...part,
                  timestamp:
                    part.timestamp != null
                      ? new Date(part.timestamp)
                      : undefined,
                });
                break;

              case 'finish':
                finished = true;
                controller.enqueue(part);
                controller.close();
                cleanup(1000);
                break;
            }
          })
          .catch(finishWithError);
      };

      socket.onerror = () => {
        // Auth rides the subprotocols, so a header-capable WebSocket
        // implementation is not required; this is a plain connection failure.
        finishWithError(
          new Error('Connection error on AI Gateway transcription stream'),
        );
      };

      socket.onclose = () => {
        finishWithError(
          new Error(
            'AI Gateway transcription stream closed before a finish part was received',
          ),
        );
      };
    },

    cancel: () => {
      if (finished) return;
      finished = true;
      cleanup();
    },
  });
}

const providerMetadataEntrySchema = z.object({}).catchall(z.unknown());

const gatewayTranscriptionWarningSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('unsupported'),
    feature: z.string(),
    details: z.string().optional(),
  }),
  z.object({
    type: z.literal('compatibility'),
    feature: z.string(),
    details: z.string().optional(),
  }),
  z.object({
    type: z.literal('deprecated'),
    setting: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('other'),
    message: z.string(),
  }),
]);

const gatewayTranscriptionResponseSchema = z.object({
  text: z.string(),
  segments: z
    .array(
      z.object({
        text: z.string(),
        startSecond: z.number(),
        endSecond: z.number(),
      }),
    )
    .optional(),
  language: z.string().nullish(),
  durationInSeconds: z.number().nullish(),
  warnings: z.array(gatewayTranscriptionWarningSchema).optional(),
  providerMetadata: z
    .record(z.string(), providerMetadataEntrySchema)
    .optional(),
});

/**
 * Errors the stream controller with the gateway-conventional wrapping of
 * `error`. Extracted because `asGatewayError` is async while the WebSocket
 * event handlers are synchronous.
 */
async function errorControllerWithGatewayError(
  controller: ReadableStreamDefaultController<TranscriptionModelV4StreamPart>,
  error: unknown,
  authMethod: 'api-key' | 'oidc' | undefined,
): Promise<void> {
  controller.error(await asGatewayError(error, authMethod));
}
