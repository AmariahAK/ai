import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWebSocketConstructor } from './websocket';

class SourceOpenEvent {
  readonly source = 'open';
}

class SourceMessageEvent {
  constructor(readonly data: unknown) {}
}

class SourceErrorEvent {
  readonly source = 'error';
}

class SourceCloseEvent {
  readonly source = 'close';
}

class SourceSocket {
  readyState = 0;
  send = vi.fn<(data: string | ArrayBuffer) => void>();
  close = vi.fn<(code?: number, reason?: string) => void>();
  onopen: ((event: SourceOpenEvent) => void) | null = null;
  onmessage: ((event: SourceMessageEvent) => void) | null = null;
  onerror: ((event: SourceErrorEvent) => void) | null = null;
  onclose: ((event: SourceCloseEvent) => void) | null = null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getWebSocketConstructor', () => {
  it('accepts a direct factory with library-specific event types', () => {
    const source = new SourceSocket();
    const createSocketMock = vi.fn();
    const createSocket = (options: {
      url: string | URL;
      protocols?: string | string[];
      headers?: Record<string, string | undefined>;
    }) => {
      createSocketMock(options);
      return source;
    };
    const WebSocket = getWebSocketConstructor(createSocket);
    const socket = new WebSocket('wss://example.com', ['protocol'], {
      headers: { Authorization: 'Bearer key' },
    });

    expect(createSocketMock).toHaveBeenCalledWith({
      url: 'wss://example.com',
      protocols: ['protocol'],
      headers: { Authorization: 'Bearer key' },
    });

    const onopen = vi.fn();
    const onmessage = vi.fn();
    const onerror = vi.fn();
    const onclose = vi.fn();
    socket.onopen = onopen;
    socket.onmessage = onmessage;
    socket.onerror = onerror;
    socket.onclose = onclose;

    const openEvent = new SourceOpenEvent();
    const messageEvent = new SourceMessageEvent('hello');
    const errorEvent = new SourceErrorEvent();
    const closeEvent = new SourceCloseEvent();
    source.onopen?.(openEvent);
    source.onmessage?.(messageEvent);
    source.onerror?.(errorEvent);
    source.onclose?.(closeEvent);

    expect(onopen).toHaveBeenCalledWith(openEvent);
    expect(onmessage).toHaveBeenCalledWith(messageEvent);
    expect(onerror).toHaveBeenCalledWith(errorEvent);
    expect(onclose).toHaveBeenCalledWith(closeEvent);
  });

  it('delegates state, send, and close operations for a factory', () => {
    const source = new SourceSocket();
    const WebSocket = getWebSocketConstructor(() => source);
    const socket = new WebSocket('wss://example.com');

    source.readyState = 1;
    expect(socket.readyState).toBe(1);

    socket.send('hello');
    const bytes = new Uint8Array([1, 2, 3]);
    socket.send(bytes);
    socket.close(1000, 'done');

    expect(source.send).toHaveBeenNthCalledWith(1, 'hello');
    expect(source.send).toHaveBeenNthCalledWith(2, bytes.buffer);
    expect(source.close).toHaveBeenCalledWith(1000, 'done');
  });

  it('preserves the legacy constructor behavior', () => {
    class LegacyWebSocket {
      readyState = 0;
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onclose: ((event: unknown) => void) | null = null;

      constructor(
        readonly url: string | URL,
        readonly protocols?: string | string[],
        readonly options?: {
          headers?: Record<string, string | undefined>;
        },
      ) {}

      send(_data: string | Uint8Array | ArrayBuffer): void {}
      close(_code?: number, _reason?: string): void {}
    }

    const WebSocket = getWebSocketConstructor(LegacyWebSocket);
    expect(WebSocket).toBe(LegacyWebSocket);
  });

  it('passes headers to a compatible runtime global', () => {
    const constructor = vi.fn();
    class RuntimeWebSocket extends SourceSocket {
      constructor(url: string | URL, options?: unknown) {
        super();
        constructor(url, options);
      }
    }
    vi.stubGlobal('WebSocket', RuntimeWebSocket);

    const WebSocket = getWebSocketConstructor(undefined);
    new WebSocket('wss://example.com', undefined, {
      headers: { Authorization: 'Bearer key' },
    });

    expect(constructor).toHaveBeenCalledWith('wss://example.com', {
      headers: { authorization: 'Bearer key' },
    });
  });

  it('explains when the runtime global cannot set connection headers', () => {
    class BrowserCompatibleWebSocket extends SourceSocket {
      constructor(_url: string | URL, protocols?: unknown) {
        super();
        if (
          protocols != null &&
          typeof protocols !== 'string' &&
          !Array.isArray(protocols)
        ) {
          throw new TypeError('protocols must be a string or string array');
        }
      }
    }
    vi.stubGlobal('WebSocket', BrowserCompatibleWebSocket);

    const WebSocket = getWebSocketConstructor(undefined);

    expect(
      () =>
        new WebSocket('wss://example.com', undefined, {
          headers: { Authorization: 'Bearer key' },
        }),
    ).toThrow(
      'The runtime WebSocket implementation does not support connection headers. Pass a custom WebSocket factory instead.',
    );
  });
});
