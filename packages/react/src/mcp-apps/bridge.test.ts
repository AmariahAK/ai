import { describe, expect, it, vi } from 'vitest';
import { MCPAppBridge } from './bridge';

const targetOrigin = 'https://proxy.example';
const initializeParams = {
  protocolVersion: '2026-01-26',
  appInfo: { name: 'test-app', version: '1.0.0' },
  appCapabilities: {},
};

function createTargetWindow() {
  return {
    postMessage: vi.fn(),
  } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
}

function messageEvent(targetWindow: Window, data: unknown): MessageEvent {
  return { source: targetWindow, origin: targetOrigin, data } as MessageEvent;
}

function originEvent(
  targetWindow: Window,
  origin: string,
  data: unknown,
): MessageEvent {
  return { source: targetWindow, origin, data } as unknown as MessageEvent;
}

describe('MCPAppBridge', () => {
  it('responds to app initialization requests', async () => {
    const targetWindow = createTargetWindow();
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
      hostInfo: { name: 'test-host', version: '1.0.0' },
      hostContext: { displayMode: 'inline' },
    });

    bridge.handleMessage(
      messageEvent(targetWindow, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/initialize',
        params: initializeParams,
      }),
    );

    await vi.waitFor(() => {
      expect(targetWindow.postMessage).toHaveBeenCalled();
    });
    expect(targetWindow.postMessage.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "id": 1,
          "jsonrpc": "2.0",
          "result": {
            "hostCapabilities": {},
            "hostContext": {
              "displayMode": "inline",
            },
            "hostInfo": {
              "name": "test-host",
              "version": "1.0.0",
            },
            "protocolVersion": "2026-01-26",
          },
        },
        "https://proxy.example",
      ]
    `);
  });

  it('queues tool notifications until the app is initialized', () => {
    const targetWindow = createTargetWindow();
    const bridge = new MCPAppBridge({ targetWindow, targetOrigin });

    bridge.sendToolInput({ topic: 'usage' });
    expect(targetWindow.postMessage).not.toHaveBeenCalled();

    bridge.handleMessage(
      messageEvent(targetWindow, {
        jsonrpc: '2.0',
        method: 'ui/notifications/initialized',
      }),
    );

    expect(targetWindow.postMessage.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "jsonrpc": "2.0",
            "method": "ui/notifications/tool-input",
            "params": {
              "arguments": {
                "topic": "usage",
              },
            },
          },
          "https://proxy.example",
        ],
      ]
    `);
  });

  it('proxies app-visible tool calls through the configured handler', async () => {
    const targetWindow = createTargetWindow();
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
      handlers: {
        allowedTools: ['refreshDashboardData'],
        callTool: async params => ({
          content: [{ type: 'text', text: `called ${params.name}` }],
        }),
      },
    });

    bridge.handleMessage(
      messageEvent(targetWindow, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'refreshDashboardData',
          arguments: { reason: 'test' },
        },
      }),
    );

    await vi.waitFor(() => {
      expect(targetWindow.postMessage).toHaveBeenCalled();
    });
    expect(targetWindow.postMessage.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "id": 2,
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "text": "called refreshDashboardData",
                "type": "text",
              },
            ],
          },
        },
        "https://proxy.example",
      ]
    `);
  });

  it('denies tool calls by default when allowedTools is omitted', async () => {
    const targetWindow = createTargetWindow();
    const callTool = vi.fn(async () => ({ content: [] }));
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
      handlers: {
        // no allowedTools => deny-by-default
        callTool,
      },
    });

    bridge.handleMessage(
      messageEvent(targetWindow, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'filesystem/write', arguments: { path: '~/.ssh' } },
      }),
    );

    await vi.waitFor(() => {
      expect(targetWindow.postMessage).toHaveBeenCalled();
    });

    // The host handler must not be invoked, and an error is returned.
    expect(callTool).not.toHaveBeenCalled();
    const [response] = targetWindow.postMessage.mock.calls[0];
    expect(response.id).toBe(3);
    expect(response.result).toBeUndefined();
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain('not app-visible');
  });

  it('denies tool calls not in allowedTools', async () => {
    const targetWindow = createTargetWindow();
    const callTool = vi.fn(async () => ({ content: [] }));
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
      handlers: {
        allowedTools: ['refreshDashboardData'],
        callTool,
      },
    });

    bridge.handleMessage(
      messageEvent(targetWindow, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'filesystem/write', arguments: {} },
      }),
    );

    await vi.waitFor(() => {
      expect(targetWindow.postMessage).toHaveBeenCalled();
    });

    expect(callTool).not.toHaveBeenCalled();
    const [response] = targetWindow.postMessage.mock.calls[0];
    expect(response.error?.message).toContain('not app-visible');
  });

  it('drops messages from an unexpected origin when a concrete origin is set', () => {
    const targetWindow = createTargetWindow();
    const onError = vi.fn();
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
      handlers: { onError },
    });

    bridge.handleMessage(
      originEvent(targetWindow, 'https://evil.example', {
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/initialize',
        params: initializeParams,
      }),
    );

    expect(targetWindow.postMessage).not.toHaveBeenCalled();
  });

  it('handles messages from the matching origin', async () => {
    const targetWindow = createTargetWindow();
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
    });

    bridge.handleMessage(
      originEvent(targetWindow, 'https://proxy.example', {
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/initialize',
        params: initializeParams,
      }),
    );

    await vi.waitFor(() => {
      expect(targetWindow.postMessage).toHaveBeenCalled();
    });
    const [, origin] = targetWindow.postMessage.mock.calls[0];
    expect(origin).toBe('https://proxy.example');
  });

  async function requestResult(method: string, params: unknown) {
    const targetWindow = createTargetWindow();
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
      handlers: {
        readResource: async p => ({ ok: p }),
        listResources: async p => ({
          resources: [
            { uri: 'ui://app/dashboard', name: 'Dashboard' },
            { uri: 'file:///etc/passwd', name: 'Private file' },
          ],
          nextCursor: p?.cursor,
        }),
        openLink: async p => ({ ok: p }),
        sendMessage: async p => ({ ok: p }),
        updateModelContext: async p => ({ ok: p }),
        requestDisplayMode: p => ({ mode: p.mode }),
      },
    });
    bridge.handleMessage(
      messageEvent(targetWindow, { jsonrpc: '2.0', id: 9, method, params }),
    );
    await vi.waitFor(() => {
      expect(targetWindow.postMessage).toHaveBeenCalled();
    });
    return targetWindow.postMessage.mock.calls[0][0];
  }

  it('rejects resources/read outside the ui:// scope', async () => {
    const response = await requestResult('resources/read', {
      uri: 'file:///etc/passwd',
    });
    expect(response.result).toBeUndefined();
    expect(response.error.message).toContain('ui://');
  });

  it('allows resources/read for ui:// resources', async () => {
    const response = await requestResult('resources/read', {
      uri: 'ui://app/data',
    });
    expect(response.result).toEqual({ ok: { uri: 'ui://app/data' } });
  });

  it('validates resources/list params and hides non-ui resources', async () => {
    const response = await requestResult('resources/list', {
      cursor: 'next-page',
    });
    expect(response.result).toEqual({
      resources: [{ uri: 'ui://app/dashboard', name: 'Dashboard' }],
      nextCursor: 'next-page',
    });

    const malformed = await requestResult('resources/list', { cursor: 42 });
    expect(malformed.error).toMatchObject({
      code: -32602,
      message: 'Invalid resources/list params',
    });
  });

  it('rejects ui/open-link with a javascript: scheme', async () => {
    const response = await requestResult('ui/open-link', {
      // eslint-disable-next-line no-script-url
      url: 'javascript:alert(1)',
    });
    expect(response.result).toBeUndefined();
    expect(response.error.message).toContain('scheme');
  });

  it('allows ui/open-link with an https URL', async () => {
    const response = await requestResult('ui/open-link', {
      url: 'https://example.com',
    });
    expect(response.result).toEqual({ ok: { url: 'https://example.com' } });
  });

  it('validates ui/message content before invoking the handler', async () => {
    const response = await requestResult('ui/message', {
      role: 'user',
      content: [{ type: 'text', text: 'Show details' }],
    });
    expect(response.result).toEqual({
      ok: {
        role: 'user',
        content: [{ type: 'text', text: 'Show details' }],
      },
    });

    for (const params of [
      { role: 'assistant', content: [] },
      { role: 'user', content: 'not-an-array' },
      { role: 'user', content: [{ type: 'text', text: 42 }] },
    ]) {
      const malformed = await requestResult('ui/message', params);
      expect(malformed.error).toMatchObject({
        code: -32602,
        message: 'Invalid ui/message params',
      });
    }
  });

  it('validates ui/update-model-context params before invoking the handler', async () => {
    const response = await requestResult('ui/update-model-context', {
      content: [{ type: 'text', text: 'Current selection' }],
      structuredContent: { selectedId: 42 },
    });
    expect(response.result).toEqual({
      ok: {
        content: [{ type: 'text', text: 'Current selection' }],
        structuredContent: { selectedId: 42 },
      },
    });

    const malformed = await requestResult('ui/update-model-context', {
      structuredContent: [],
    });
    expect(malformed.error).toMatchObject({
      code: -32602,
      message: 'Invalid ui/update-model-context params',
    });
  });

  it('rejects malformed request params', async () => {
    const readResponse = await requestResult('resources/read', { uri: 42 });
    expect(readResponse.error.message).toContain('resources/read');

    const modeResponse = await requestResult('ui/request-display-mode', {
      mode: 'zoomed',
    });
    expect(modeResponse.error.message).toContain('ui/request-display-mode');
  });

  it('rejects malformed initialization and tool arguments', async () => {
    const initializeResponse = await requestResult('ui/initialize', {});
    expect(initializeResponse.error).toMatchObject({
      code: -32602,
      message: 'Invalid ui/initialize params',
    });

    const targetWindow = createTargetWindow();
    const callTool = vi.fn();
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin,
      handlers: {
        allowedTools: ['refreshDashboardData'],
        callTool,
      },
    });
    bridge.handleMessage(
      messageEvent(targetWindow, {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'refreshDashboardData', arguments: [] },
      }),
    );

    await vi.waitFor(() => {
      expect(targetWindow.postMessage).toHaveBeenCalled();
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(targetWindow.postMessage.mock.calls[0][0].error).toMatchObject({
      code: -32602,
      message: 'Invalid tools/call params',
    });
  });

  it('supports ping and rejects malformed ping params', async () => {
    expect((await requestResult('ping', undefined)).result).toEqual({});
    expect((await requestResult('ping', [])).error).toMatchObject({
      code: -32602,
      message: 'Invalid ping params',
    });
  });

  it('returns method-not-found for unsupported methods', async () => {
    const response = await requestResult('unknown/method', {});
    expect(response.error.code).toBe(-32601);
  });

  it.each(['*', 'data:text/html,test', 'not an origin'])(
    'rejects a non-concrete target origin: %s',
    invalidOrigin => {
      expect(
        () =>
          new MCPAppBridge({
            targetWindow: createTargetWindow(),
            targetOrigin: invalidOrigin,
          }),
      ).toThrow(/targetOrigin/);
    },
  );

  it('normalizes the configured target origin', async () => {
    const targetWindow = createTargetWindow();
    const bridge = new MCPAppBridge({
      targetWindow,
      targetOrigin: 'https://PROXY.example:443/sandbox',
    });

    bridge.handleMessage(
      originEvent(targetWindow, targetOrigin, {
        jsonrpc: '2.0',
        id: 10,
        method: 'ui/initialize',
        params: initializeParams,
      }),
    );

    await vi.waitFor(() => {
      expect(targetWindow.postMessage).toHaveBeenCalled();
    });
    expect(targetWindow.postMessage.mock.calls[0][1]).toBe(targetOrigin);
  });
});
