const defaultAppCSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self' data:; media-src 'self' data:; frame-src 'none'";

function normalizeOrigin(value: string): string | undefined {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

function createSandboxProxyHtml(expectedParentOrigin: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body, iframe {
        width: 100%;
        height: 100%;
        margin: 0;
        border: 0;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <script>
      const expectedParentOrigin = ${JSON.stringify(expectedParentOrigin)};
      const defaultAppCSP = ${JSON.stringify(defaultAppCSP)};
      let appFrame;

      function isJsonRpc(value) {
        return value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          value.jsonrpc === '2.0';
      }

      function isReservedSandboxMessage(value) {
        return isJsonRpc(value) &&
          typeof value.method === 'string' &&
          value.method.startsWith('ui/notifications/sandbox-');
      }

      function isResourceReadyParams(value) {
        return value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          typeof value.html === 'string' &&
          (value.csp === undefined || typeof value.csp === 'string') &&
          (value.sandbox === undefined || typeof value.sandbox === 'string') &&
          (value.allow === undefined || typeof value.allow === 'string');
      }

      function injectCSP(html, csp) {
        const document = new DOMParser().parseFromString(html, 'text/html');
        const meta = document.createElement('meta');
        meta.httpEquiv = 'Content-Security-Policy';
        meta.content = csp || defaultAppCSP;
        document.head.prepend(meta);
        return '<!doctype html>' + document.documentElement.outerHTML;
      }

      function createAppFrame(params) {
        appFrame?.remove();
        appFrame = document.createElement('iframe');
        appFrame.sandbox = params.sandbox || 'allow-scripts allow-forms';
        if (params.allow) {
          appFrame.allow = params.allow;
        }
        appFrame.srcdoc = injectCSP(params.html, params.csp);
        document.body.appendChild(appFrame);
      }

      window.addEventListener('message', event => {
        const data = event.data;
        const fromTrustedParent =
          event.source === window.parent &&
          event.origin === expectedParentOrigin;

        if (fromTrustedParent) {
          if (
            isJsonRpc(data) &&
            data.method === 'ui/notifications/sandbox-resource-ready' &&
            isResourceReadyParams(data.params)
          ) {
            createAppFrame(data.params);
            return;
          }

          if (isJsonRpc(data) && appFrame && !isReservedSandboxMessage(data)) {
            // The inner srcdoc frame has an opaque origin by default, so a
            // concrete postMessage target is impossible. The exact
            // contentWindow check and reserved-message filter are the boundary.
            appFrame.contentWindow.postMessage(data, '*');
          }
          return;
        }

        if (
          isJsonRpc(data) &&
          event.source === appFrame?.contentWindow &&
          !isReservedSandboxMessage(data)
        ) {
          window.parent.postMessage(data, expectedParentOrigin);
        }
      });

      window.parent.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/sandbox-proxy-ready'
      }, expectedParentOrigin);
    </script>
  </body>
</html>`;
}

export function GET(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const configuredHostOrigin = process.env.MCP_APP_HOST_ORIGIN;
  const expectedParentOrigin = normalizeOrigin(
    configuredHostOrigin ?? requestOrigin,
  );

  if (expectedParentOrigin == null) {
    return new Response('MCP_APP_HOST_ORIGIN must be a concrete origin', {
      status: 500,
    });
  }

  return new Response(createSandboxProxyHtml(expectedParentOrigin), {
    headers: {
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'",
      'content-type': 'text/html; charset=utf-8',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
    },
  });
}
