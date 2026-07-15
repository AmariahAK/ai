import {
  getWebSocketConstructor,
  normalizeHeaders,
  readWebSocketMessageText,
  safeParseJSON,
  toWebSocketUrl,
  type ParseResult,
  type WebSocketConstructor,
  type WebSocketLike,
} from '@ai-sdk/provider-utils';
import {
  openaiResponsesChunkSchema,
  type OpenAIResponsesChunk,
} from './openai-responses-api';

export type OpenAIResponsesWebSocketResult = {
  stream: ReadableStream<ParseResult<OpenAIResponsesChunk>>;
  /**
   * Completes this response's lifecycle. Tool call IDs keep the socket ready
   * for the matching next AI SDK step; an empty array closes it immediately.
   */
  finish(toolCallIds: string[]): void;
  close(): void;
};

export type OpenAIResponsesWebSocketContinuation = {
  toolCallIds: string[];
  input: unknown[];
};

/**
 * Bridges the separate language-model calls that AI SDK makes for consecutive
 * steps of one model -> client tool -> model turn.
 *
 * This is not a general connection pool. A completed socket is registered only
 * under the real tool call IDs emitted by that response. The next provider call
 * can claim it only by returning results for one of those IDs; unrelated and
 * concurrent calls create their own sockets.
 */
export class OpenAIResponsesWebSocketManager {
  private readonly connectionsAwaitingToolResults = new Map<
    string,
    OpenAIResponsesWebSocketConnection
  >();

  constructor(private readonly webSocket?: WebSocketConstructor) {}

  async request({
    url,
    headers,
    body,
    abortSignal,
    continuation,
  }: {
    url: string;
    headers: Record<string, string | undefined>;
    body: Record<string, unknown>;
    abortSignal?: AbortSignal;
    continuation?: OpenAIResponsesWebSocketContinuation;
  }): Promise<OpenAIResponsesWebSocketResult> {
    // A tool-result prompt can claim the socket that produced that tool call.
    let connection = this.takeContinuationConnection(
      continuation?.toolCallIds ?? [],
    );

    // Reusing a socket is an optimization, not a correctness requirement. If
    // any state differs, discard it and send the full prompt on a new socket.
    let requestBody: Record<string, unknown> | undefined;
    if (connection != null) {
      requestBody = connection.createContinuationBody({
        url,
        headers,
        body,
        continuationInput: continuation?.input ?? [],
      });
    }

    if (connection != null && requestBody == null) {
      connection.close();
      connection = undefined;
    }

    if (connection == null) {
      connection = new OpenAIResponsesWebSocketConnection({
        url,
        headers,
        webSocket: getWebSocketConstructor(this.webSocket),
        onClose: closedConnection =>
          this.removePendingConnection(closedConnection),
      });
    }

    const stream = await connection.request({
      body: requestBody ?? body,
      fullInput: body.input,
      configuredPreviousResponseId: body.previous_response_id,
      conversation: body.conversation,
      abortSignal,
    });

    let finished = false;
    return {
      stream,
      finish: toolCallIds => {
        if (finished) return;
        finished = true;

        if (toolCallIds.length === 0 || connection.isClosed) {
          connection.close();
          return;
        }

        if (!connection.waitForToolResults(abortSignal)) {
          return;
        }
        for (const toolCallId of toolCallIds) {
          this.connectionsAwaitingToolResults.set(toolCallId, connection);
        }
      },
      close: () => {
        if (finished) return;
        finished = true;
        connection.close();
      },
    };
  }

  private takeContinuationConnection(
    continuationToolCallIds: string[],
  ): OpenAIResponsesWebSocketConnection | undefined {
    // Parallel tool calls can produce several IDs for one response. Whichever
    // result appears first claims the connection, then every alias is removed.
    for (const toolCallId of continuationToolCallIds) {
      const connection = this.connectionsAwaitingToolResults.get(toolCallId);
      if (connection == null) continue;

      if (connection.isClosed) {
        this.removePendingConnection(connection);
        continue;
      }

      this.removePendingConnection(connection);
      connection.resume();
      return connection;
    }

    return undefined;
  }

  private removePendingConnection(
    connection: OpenAIResponsesWebSocketConnection,
  ): void {
    for (const [toolCallId, pendingConnection] of this
      .connectionsAwaitingToolResults) {
      if (pendingConnection === connection) {
        this.connectionsAwaitingToolResults.delete(toolCallId);
      }
    }
  }
}

/** Owns one physical socket and its sequential response.create requests. */
class OpenAIResponsesWebSocketConnection {
  private readonly socket: WebSocketLike;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly opened: Promise<void>;
  private resolveOpened: (() => void) | undefined;
  private rejectOpened: ((error: unknown) => void) | undefined;
  private activeRequest:
    | {
        controller: ReadableStreamDefaultController<
          ParseResult<OpenAIResponsesChunk>
        >;
        fullInput: unknown;
        configuredPreviousResponseId: unknown;
        conversation: unknown;
        abortSignal?: AbortSignal;
        abortListener?: () => void;
      }
    | undefined;
  private messageQueue = Promise.resolve();
  private pendingAbortSignal: AbortSignal | undefined;
  private pendingAbortListener: (() => void) | undefined;
  private intentionallyClosed = false;
  private openedSuccessfully = false;
  private previousFullInput: unknown;
  private configuredPreviousResponseId: unknown;
  private conversation: unknown;
  private responseId: string | undefined;

  constructor({
    url,
    headers,
    webSocket,
    onClose,
  }: {
    url: string;
    headers: Record<string, string | undefined>;
    webSocket: WebSocketConstructor;
    onClose: (connection: OpenAIResponsesWebSocketConnection) => void;
  }) {
    this.url = url;
    this.headers = normalizeHeaders(headers);
    this.opened = new Promise<void>((resolve, reject) => {
      this.resolveOpened = resolve;
      this.rejectOpened = reject;
    });

    this.socket = new webSocket(toWebSocketUrl(url), undefined, { headers });
    this.socket.onopen = () => {
      this.openedSuccessfully = true;
      this.resolveOpened?.();
      this.resolveOpened = undefined;
      this.rejectOpened = undefined;
    };
    this.socket.onmessage = event => {
      this.messageQueue = this.messageQueue
        .then(() => this.handleMessage(event.data))
        .catch(error => this.fail(error));
    };
    this.socket.onerror = event => {
      this.fail(
        createWebSocketError('OpenAI Responses WebSocket failed.', event),
      );
    };
    this.socket.onclose = event => {
      onClose(this);
      if (!this.intentionallyClosed) {
        this.fail(
          createWebSocketError(
            'OpenAI Responses WebSocket closed unexpectedly.',
            event,
          ),
        );
      }
    };
  }

  get isClosed(): boolean {
    return this.intentionallyClosed || this.socket.readyState >= 2;
  }

  matches(url: string, headers: Record<string, string | undefined>): boolean {
    const normalizedHeaders = normalizeHeaders(headers);
    const headerNames = Object.keys(this.headers);
    return (
      this.url === url &&
      headerNames.length === Object.keys(normalizedHeaders).length &&
      headerNames.every(name => this.headers[name] === normalizedHeaders[name])
    );
  }

  createContinuationBody({
    url,
    headers,
    body,
    continuationInput,
  }: {
    url: string;
    headers: Record<string, string | undefined>;
    body: Record<string, unknown>;
    continuationInput: unknown[];
  }): Record<string, unknown> | undefined {
    // Only remove the already-sent input prefix when every piece of request
    // state still matches. This makes the fallback to a full request safe when
    // callers change credentials, conversation state, or provider options.
    if (
      !this.matches(url, headers) ||
      continuationInput.length === 0 ||
      !isInputPrefix(this.previousFullInput, body.input) ||
      !isSameJsonValue(
        this.configuredPreviousResponseId,
        body.previous_response_id,
      ) ||
      !isSameJsonValue(this.conversation, body.conversation)
    ) {
      return undefined;
    }

    if (body.conversation == null && this.responseId == null) {
      return undefined;
    }

    return {
      ...body,
      // OpenAI's active-socket fast path expects only newly added input items
      // and the immediately preceding response ID.
      input: continuationInput,
      previous_response_id:
        body.conversation == null ? this.responseId : undefined,
    };
  }

  async request({
    body,
    fullInput,
    configuredPreviousResponseId,
    conversation,
    abortSignal,
  }: {
    body: Record<string, unknown>;
    fullInput: unknown;
    configuredPreviousResponseId: unknown;
    conversation: unknown;
    abortSignal?: AbortSignal;
  }): Promise<ReadableStream<ParseResult<OpenAIResponsesChunk>>> {
    // OpenAI supports multiple sequential responses per connection, but no
    // multiplexing. A second in-flight response therefore indicates a bug in
    // the coordinator rather than a request we can safely interleave.
    if (this.activeRequest != null) {
      throw new Error(
        'OpenAI Responses WebSocket only supports one in-flight response.',
      );
    }

    if (abortSignal?.aborted) {
      this.close();
      throw abortSignal.reason ?? new Error('Request aborted.');
    }

    try {
      await this.waitUntilOpen(abortSignal);
    } catch (error) {
      this.close();
      throw error;
    }

    let activeRequest:
      | OpenAIResponsesWebSocketConnection['activeRequest']
      | undefined;
    const stream = new ReadableStream<ParseResult<OpenAIResponsesChunk>>({
      start: controller => {
        const abortListener = () => {
          controller.error(
            abortSignal?.reason ?? new Error('Request aborted.'),
          );
          this.activeRequest = undefined;
          this.close();
        };
        activeRequest = {
          controller,
          fullInput,
          configuredPreviousResponseId,
          conversation,
          abortSignal,
          abortListener,
        };
        this.activeRequest = activeRequest;
        abortSignal?.addEventListener('abort', abortListener, { once: true });
      },
      cancel: () => {
        if (this.activeRequest === activeRequest) {
          this.clearActiveRequest();
        }
        this.close();
      },
    });

    try {
      // `stream` is implicit in WebSocket mode; the client event discriminator
      // is the only transport-specific field added to the Responses body.
      this.socket.send(
        JSON.stringify({
          ...body,
          type: 'response.create',
        }),
      );
    } catch (error) {
      this.fail(error);
      throw error;
    }

    return stream;
  }

  waitForToolResults(abortSignal?: AbortSignal): boolean {
    // AI SDK tool execution has no implicit timeout. Keep the socket available
    // for the matching result for as long as the surrounding call remains
    // active; explicit aborts and remote socket closure still clean it up.
    this.clearPendingAbortListener();

    if (abortSignal?.aborted) {
      this.close();
      return false;
    }

    if (abortSignal != null) {
      this.pendingAbortSignal = abortSignal;
      this.pendingAbortListener = () => this.close();
      abortSignal.addEventListener('abort', this.pendingAbortListener, {
        once: true,
      });
    }

    return true;
  }

  resume(): void {
    this.clearPendingAbortListener();
  }

  close(): void {
    if (this.intentionallyClosed) return;
    this.intentionallyClosed = true;
    this.clearPendingAbortListener();
    this.clearActiveRequest();
    this.rejectOpened?.(new Error('OpenAI Responses WebSocket was closed.'));
    this.rejectOpened = undefined;
    this.resolveOpened = undefined;
    this.socket.close();
  }

  private async waitUntilOpen(abortSignal?: AbortSignal): Promise<void> {
    if (this.openedSuccessfully) return;
    if (abortSignal == null) return this.opened;

    let abortListener: (() => void) | undefined;
    try {
      await Promise.race([
        this.opened,
        new Promise<never>((_, reject) => {
          abortListener = () =>
            reject(abortSignal.reason ?? new Error('Request aborted.'));
          abortSignal.addEventListener('abort', abortListener, { once: true });
        }),
      ]);
    } finally {
      if (abortListener != null) {
        abortSignal.removeEventListener('abort', abortListener);
      }
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    const activeRequest = this.activeRequest;
    if (activeRequest == null) return;

    const result = await safeParseJSON({
      text: await readWebSocketMessageText(data),
      schema: openaiResponsesChunkSchema,
    });
    activeRequest.controller.enqueue(result);

    if (!result.success) {
      this.clearActiveRequest();
      activeRequest.controller.close();
      this.close();
      return;
    }

    if (
      result.value.type === 'response.completed' ||
      result.value.type === 'response.incomplete'
    ) {
      // Save exactly the state needed to prove that the next full AI SDK prompt
      // is an extension of this response. The response ID enables OpenAI's
      // connection-local continuation cache.
      this.previousFullInput = activeRequest.fullInput;
      this.configuredPreviousResponseId =
        activeRequest.configuredPreviousResponseId;
      this.conversation = activeRequest.conversation;
      this.responseId = result.value.response.id ?? undefined;
      this.clearActiveRequest();
      this.waitForToolResults(activeRequest.abortSignal);
      activeRequest.controller.close();
    } else if (
      result.value.type === 'response.failed' ||
      result.value.type === 'error'
    ) {
      this.clearActiveRequest();
      activeRequest.controller.close();
      this.close();
    }
  }

  private fail(error: unknown): void {
    this.rejectOpened?.(error);
    this.rejectOpened = undefined;
    this.resolveOpened = undefined;

    const activeRequest = this.activeRequest;
    if (activeRequest != null) {
      this.clearActiveRequest();
      activeRequest.controller.error(error);
    }
    this.close();
  }

  private clearActiveRequest(): void {
    const activeRequest = this.activeRequest;
    if (
      activeRequest?.abortSignal != null &&
      activeRequest.abortListener != null
    ) {
      activeRequest.abortSignal.removeEventListener(
        'abort',
        activeRequest.abortListener,
      );
    }
    this.activeRequest = undefined;
  }

  private clearPendingAbortListener(): void {
    if (this.pendingAbortSignal != null && this.pendingAbortListener != null) {
      this.pendingAbortSignal.removeEventListener(
        'abort',
        this.pendingAbortListener,
      );
    }
    this.pendingAbortSignal = undefined;
    this.pendingAbortListener = undefined;
  }
}

function createWebSocketError(message: string, cause: unknown): Error {
  const error = new Error(message);
  if (cause != null) {
    Object.defineProperty(error, 'cause', { value: cause });
  }
  return error;
}

function isInputPrefix(previousInput: unknown, currentInput: unknown): boolean {
  if (!Array.isArray(previousInput) || !Array.isArray(currentInput)) {
    return false;
  }

  return (
    previousInput.length <= currentInput.length &&
    previousInput.every((item, index) =>
      isSameJsonValue(item, currentInput[index]),
    )
  );
}

function isSameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
