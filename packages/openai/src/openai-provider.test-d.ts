import { createOpenAI, type OpenAIProviderSettings } from './openai-provider';

class CustomWebSocket {
  readonly readyState = 0;
  onopen: ((event: { type: 'open' }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: { error: Error }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(
    readonly url: string | URL,
    readonly headers?: Record<string, string | undefined>,
  ) {}

  send(_data: string | ArrayBuffer): void {}
  close(_code?: number, _reason?: string): void {}
}

createOpenAI({
  webSocket: ({ url, headers }) => new CustomWebSocket(url, headers),
});

const standardSettings: OpenAIProviderSettings = {
  webSocket: ({ url, protocols }) => new WebSocket(url, protocols),
};

createOpenAI(standardSettings);
