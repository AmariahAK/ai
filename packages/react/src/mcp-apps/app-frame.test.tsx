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

describe('MCPAppFrame session lifecycle', () => {
  it('replaces and revokes the outer iframe when app HTML changes', () => {
    const { rerender } = render(
      <MCPAppFrame
        app={app}
        resource={resource}
        sandbox={{ url: 'https://proxy.example/sandbox' }}
      />,
    );
    const initialIframe = screen.getByTitle('MCP App') as HTMLIFrameElement;
    const postMessage = vi
      .spyOn(initialIframe.contentWindow!, 'postMessage')
      .mockImplementation(() => {});

    rerender(
      <MCPAppFrame
        app={app}
        resource={{ ...resource, html: '<html>updated</html>' }}
        sandbox={{ url: 'https://proxy.example/sandbox' }}
      />,
    );

    expect(screen.getByTitle('MCP App')).not.toBe(initialIframe);
    expect(initialIframe.src).toBe('about:blank');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'ui/resource-teardown' }),
      'https://proxy.example',
    );
  });

  it.each([
    {
      name: 'resource URI',
      resource: { ...resource, uri: 'ui://app/replacement' },
      sandbox: { url: 'https://proxy.example/sandbox' },
    },
    {
      name: 'CSP',
      resource: {
        ...resource,
        meta: { csp: { connectDomains: ['https://api.example'] } },
      },
      sandbox: { url: 'https://proxy.example/sandbox' },
    },
    {
      name: 'outer sandbox policy',
      resource,
      sandbox: {
        url: 'https://proxy.example/sandbox',
        outerSandbox: 'allow-scripts',
      },
    },
    {
      name: 'inner sandbox policy',
      resource,
      sandbox: {
        url: 'https://proxy.example/sandbox',
        innerSandbox: 'allow-scripts',
      },
    },
    {
      name: 'proxy origin',
      resource,
      sandbox: { url: 'https://other-proxy.example/sandbox' },
    },
  ])(
    'replaces the iframe when the $name changes',
    ({ resource: updatedResource, sandbox }) => {
      const { rerender } = render(
        <MCPAppFrame
          app={app}
          resource={resource}
          sandbox={{ url: 'https://proxy.example/sandbox' }}
        />,
      );
      const initialIframe = screen.getByTitle('MCP App');

      rerender(
        <MCPAppFrame app={app} resource={updatedResource} sandbox={sandbox} />,
      );

      expect(screen.getByTitle('MCP App')).not.toBe(initialIframe);
    },
  );

  it('keeps the iframe for equivalent policy and ordinary state updates', () => {
    const { rerender } = render(
      <MCPAppFrame
        app={app}
        resource={resource}
        sandbox={{
          url: 'https://proxy.example/sandbox',
          className: 'initial',
        }}
        handlers={{}}
        hostContext={{ theme: 'light' }}
        input={{ value: 1 }}
      />,
    );
    const initialIframe = screen.getByTitle('MCP App');

    rerender(
      <MCPAppFrame
        app={{ ...app }}
        resource={{ ...resource }}
        sandbox={{
          url: new URL('https://proxy.example/sandbox'),
          className: 'updated',
        }}
        handlers={{}}
        hostContext={{ theme: 'dark' }}
        input={{ value: 2 }}
        output={{ content: [{ type: 'text', text: 'done' }] }}
      />,
    );

    expect(screen.getByTitle('MCP App')).toBe(initialIframe);
    expect(initialIframe).toHaveClass('updated');
  });

  it('navigates to the proxy after mounting the iframe', () => {
    render(
      <MCPAppFrame
        app={app}
        resource={resource}
        sandbox={{ url: 'https://proxy.example/sandbox' }}
      />,
    );

    const iframe = screen.getByTitle('MCP App') as HTMLIFrameElement;
    expect(iframe.src).toBe('https://proxy.example/sandbox');
    expect(iframe.getAttribute('src')).toBe('https://proxy.example/sandbox');
  });
});
