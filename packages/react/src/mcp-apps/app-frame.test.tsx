import { MCP_APP_MIME_TYPE } from '@ai-sdk/mcp';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveTargetOrigin, MCPAppFrame } from './app-frame';

const app = {
  resourceUri: 'ui://app/dashboard',
  mimeType: MCP_APP_MIME_TYPE,
};

const resource = {
  uri: app.resourceUri,
  mimeType: MCP_APP_MIME_TYPE,
  html: '<!doctype html><html></html>',
};

afterEach(() => {
  cleanup();
});

function dispatchProxyReady(iframe: HTMLIFrameElement, origin: string) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        origin,
        data: {
          jsonrpc: '2.0',
          method: 'ui/notifications/sandbox-proxy-ready',
        },
      }),
    );
  });
}

describe('MCPAppFrame origin handling', () => {
  it('posts resource data only to the origin derived from the sandbox URL', () => {
    render(
      <MCPAppFrame
        app={app}
        resource={resource}
        sandbox={{ url: 'https://proxy.example/sandbox' }}
      />,
    );

    const iframe = screen.getByTitle('MCP App') as HTMLIFrameElement;
    const postMessage = vi
      .spyOn(iframe.contentWindow!, 'postMessage')
      .mockImplementation(() => {});
    dispatchProxyReady(iframe, 'https://proxy.example');

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'ui/notifications/sandbox-resource-ready',
      }),
      'https://proxy.example',
    );
  });

  it('normalizes an explicit redirect origin before sending and receiving', () => {
    render(
      <MCPAppFrame
        app={app}
        resource={resource}
        sandbox={{
          url: 'https://redirector.example/sandbox',
          targetOrigin: 'https://PROXY.example:443/redirected/path',
        }}
      />,
    );

    const iframe = screen.getByTitle('MCP App') as HTMLIFrameElement;
    const postMessage = vi
      .spyOn(iframe.contentWindow!, 'postMessage')
      .mockImplementation(() => {});
    dispatchProxyReady(iframe, 'https://proxy.example');

    expect(postMessage).toHaveBeenCalledWith(
      expect.anything(),
      'https://proxy.example',
    );
  });

  it.each([
    { url: 'https://proxy.example', targetOrigin: '*' },
    { url: 'https://proxy.example', targetOrigin: 'not-an-absolute-origin' },
    { url: 'data:text/html,sandbox' },
  ])('rejects a wildcard, malformed, or opaque origin: %o', sandbox => {
    expect(() =>
      deriveTargetOrigin(String(sandbox.url), sandbox.targetOrigin),
    ).toThrow(/sandbox (targetOrigin|origin)/);
  });
});
