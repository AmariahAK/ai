import { delay } from './delay';
import { normalizeHeaders } from './normalize-headers';

export type WebSocketLike = {
  readyState: number;
  /** Bytes queued by `send` but not yet transmitted (native + `ws`). */
  readonly bufferedAmount?: number;
  send(data: string | Uint8Array | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
};

export type WebSocketFactoryOptions = {
  url: string | URL;
  protocols?: string | string[];
  headers?: Record<string, string | undefined>;
};

export type WebSocketFactorySocket<
  OPEN_EVENT = Event,
  MESSAGE_EVENT extends { data: unknown } = MessageEvent,
  ERROR_EVENT = ErrorEvent,
  CLOSE_EVENT = CloseEvent,
> = {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: OPEN_EVENT) => void) | null;
  onmessage: ((event: MESSAGE_EVENT) => void) | null;
  onerror: ((event: ERROR_EVENT) => void) | null;
  onclose: ((event: CLOSE_EVENT) => void) | null;
};

export type WebSocketFactory<
  OPEN_EVENT = Event,
  MESSAGE_EVENT extends { data: unknown } = MessageEvent,
  ERROR_EVENT = ErrorEvent,
  CLOSE_EVENT = CloseEvent,
> = (
  options: WebSocketFactoryOptions,
) => WebSocketFactorySocket<
  OPEN_EVENT,
  MESSAGE_EVENT,
  ERROR_EVENT,
  CLOSE_EVENT
>;

export type WebSocketConstructor = new (
  url: string | URL,
  protocols?: string | string[],
  options?: {
    headers?: Record<string, string | undefined>;
  },
) => WebSocketLike;

/**
 * Resolves a WebSocket implementation to the constructor shape used by AI SDK
 * providers. Custom implementations can be supplied either as the legacy
 * constructor or as a non-constructible factory (for example, an arrow
 * function) that adapts a WebSocket client with a different API.
 */
export function getWebSocketConstructor<
  OPEN_EVENT,
  MESSAGE_EVENT extends { data: unknown },
  ERROR_EVENT,
  CLOSE_EVENT,
>(
  webSocket:
    | WebSocketConstructor
    | WebSocketFactory<OPEN_EVENT, MESSAGE_EVENT, ERROR_EVENT, CLOSE_EVENT>
    | undefined,
): WebSocketConstructor {
  if (webSocket != null) {
    if (isWebSocketConstructor(webSocket)) {
      return webSocket;
    }

    return createFactoryConstructor(webSocket);
  }

  const GlobalWebSocket = globalThis.WebSocket;
  if (GlobalWebSocket == null) {
    throw new Error('No WebSocket implementation available.');
  }

  return createFactoryConstructor(({ url, protocols, headers }) => {
    // Browsers use subprotocols for OpenAI streaming transcription. Server
    // runtimes additionally support an options object with connection headers,
    // which Responses WebSocket mode requires.
    if (protocols != null) {
      return new GlobalWebSocket(url, protocols);
    }

    const normalizedHeaders = normalizeHeaders(headers);
    if (Object.keys(normalizedHeaders).length === 0) {
      return new GlobalWebSocket(url);
    }

    let socket: unknown;
    try {
      socket = Reflect.construct(GlobalWebSocket, [
        url,
        { headers: normalizedHeaders },
      ]);
    } catch (error) {
      const webSocketError = new Error(
        'The runtime WebSocket implementation does not support connection headers. Pass a custom WebSocket factory instead.',
      );
      Object.defineProperty(webSocketError, 'cause', { value: error });
      throw webSocketError;
    }

    if (!isWebSocketFactorySocket(socket)) {
      throw new Error(
        'The runtime WebSocket implementation returned an incompatible client.',
      );
    }

    return socket;
  });
}

function createFactoryConstructor<
  OPEN_EVENT,
  MESSAGE_EVENT extends { data: unknown },
  ERROR_EVENT,
  CLOSE_EVENT,
>(
  factory: WebSocketFactory<
    OPEN_EVENT,
    MESSAGE_EVENT,
    ERROR_EVENT,
    CLOSE_EVENT
  >,
): WebSocketConstructor {
  return class implements WebSocketLike {
    private readonly socket: WebSocketFactorySocket<
      OPEN_EVENT,
      MESSAGE_EVENT,
      ERROR_EVENT,
      CLOSE_EVENT
    >;
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;

    constructor(
      url: string | URL,
      protocols?: string | string[],
      options?: { headers?: Record<string, string | undefined> },
    ) {
      this.socket = factory({ url, protocols, headers: options?.headers });
      this.socket.onopen = event => this.onopen?.(event);
      this.socket.onmessage = event => this.onmessage?.(event);
      this.socket.onerror = event => this.onerror?.(event);
      this.socket.onclose = event => this.onclose?.(event);
    }

    get readyState(): number {
      return this.socket.readyState;
    }

    get bufferedAmount(): number | undefined {
      return this.socket.bufferedAmount;
    }

    send(data: string | Uint8Array | ArrayBuffer): void {
      this.socket.send(
        data instanceof Uint8Array ? new Uint8Array(data).buffer : data,
      );
    }

    close(code?: number, reason?: string): void {
      this.socket.close(code, reason);
    }
  };
}

function isWebSocketConstructor<
  OPEN_EVENT,
  MESSAGE_EVENT extends { data: unknown },
  ERROR_EVENT,
  CLOSE_EVENT,
>(
  webSocket:
    | WebSocketConstructor
    | WebSocketFactory<OPEN_EVENT, MESSAGE_EVENT, ERROR_EVENT, CLOSE_EVENT>,
): webSocket is WebSocketConstructor {
  try {
    Reflect.construct(Function, [], webSocket);
    return true;
  } catch {
    return false;
  }
}

function isWebSocketFactorySocket(
  value: unknown,
): value is WebSocketFactorySocket<
  unknown,
  { data: unknown },
  unknown,
  unknown
> {
  return (
    typeof value === 'object' &&
    value != null &&
    'readyState' in value &&
    typeof value.readyState === 'number' &&
    'send' in value &&
    typeof value.send === 'function' &&
    'close' in value &&
    typeof value.close === 'function' &&
    'onopen' in value &&
    'onmessage' in value &&
    'onerror' in value &&
    'onclose' in value
  );
}

/**
 * Converts an http(s) URL to the corresponding ws(s) URL.
 */
export function toWebSocketUrl(url: string | URL): URL {
  const wsUrl = new URL(url);
  if (wsUrl.protocol === 'http:') {
    wsUrl.protocol = 'ws:';
  } else if (wsUrl.protocol === 'https:') {
    wsUrl.protocol = 'wss:';
  }
  return wsUrl;
}

const textDecoder = new TextDecoder();

/**
 * Reads WebSocket message data as text, handling string, binary,
 * and Blob payloads.
 */
export async function readWebSocketMessageText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return textDecoder.decode(data);
  if (ArrayBuffer.isView(data)) {
    return textDecoder.decode(data);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.text();
  }
  return String(data);
}

const WEBSOCKET_OPEN_STATE = 1;

/**
 * Waits until the socket's send buffer drains below `highWaterMark` bytes.
 * No-op for implementations that do not expose `bufferedAmount`. There is no
 * portable drain event, so this polls. Returns as soon as the socket is no
 * longer open or the signal aborts — `bufferedAmount` never drains on a
 * closed socket, so waiting on would poll forever.
 */
export async function waitForWebSocketBufferDrain(
  socket: WebSocketLike,
  {
    highWaterMark = 1024 * 1024,
    pollIntervalMs = 20,
    abortSignal,
  }: {
    highWaterMark?: number;
    pollIntervalMs?: number;
    abortSignal?: AbortSignal;
  } = {},
): Promise<void> {
  while (
    socket.readyState === WEBSOCKET_OPEN_STATE &&
    (socket.bufferedAmount ?? 0) > highWaterMark
  ) {
    if (abortSignal?.aborted === true) {
      return;
    }
    await delay(pollIntervalMs);
  }
}
