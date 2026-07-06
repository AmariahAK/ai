import {
  AbstractChat,
  DefaultChatTransport,
  convertToModelMessages,
  lastAssistantMessageIsCompleteWithToolCalls,
  type ChatInit,
  type ChatState,
  type ChatStatus,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const toolCallCount = Number.parseInt(
  process.env.APPLY_PATCH_TOOL_CALL_COUNT ?? '5',
  10,
);
const applyPatchOperation = process.env.APPLY_PATCH_OPERATION ?? 'create';

if (!Number.isInteger(toolCallCount) || toolCallCount < 1) {
  throw new Error('APPLY_PATCH_TOOL_CALL_COUNT must be a positive integer.');
}

const toolCallIds = Array.from(
  { length: toolCallCount },
  (_, index) => `call_apply_patch_${index}`,
);

class ReactLikeChatState<UI_MESSAGE extends UIMessage>
  implements ChatState<UI_MESSAGE>
{
  status: ChatStatus = 'ready';
  error: Error | undefined;
  messages: UI_MESSAGE[];

  constructor(initialMessages: UI_MESSAGE[] = []) {
    this.messages = [...initialMessages];
  }

  pushMessage = (message: UI_MESSAGE) => {
    this.messages = this.messages.concat(message);
  };

  popMessage = () => {
    this.messages = this.messages.slice(0, -1);
  };

  replaceMessage = (index: number, message: UI_MESSAGE) => {
    this.messages = [
      ...this.messages.slice(0, index),
      this.snapshot(message),
      ...this.messages.slice(index + 1),
    ];
  };

  snapshot = <T>(value: T): T => structuredClone(value);
}

class TestChat extends AbstractChat<UIMessage> {
  constructor(init: ChatInit<UIMessage>) {
    super({
      ...init,
      state: new ReactLikeChatState(init.messages ?? []),
    });
  }
}

function formatChunk(chunk: UIMessageChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function writeChunk(response: ServerResponse, chunk: UIMessageChunk) {
  response.write(formatChunk(chunk));
}

async function readJsonBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const requests: any[] = [];
  let secondRequestSawAllOutputs = false;
  let secondRequestModelMessages: Awaited<ReturnType<typeof convertToModelMessages>> | undefined;

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/api/chat') {
        response.writeHead(404).end();
        return;
      }

      const body = await readJsonBody(request);
      requests.push(body);

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      if (requests.length === 1) {
        writeChunk(response, { type: 'start' });
        writeChunk(response, { type: 'start-step' });

        for (const toolCallId of toolCallIds) {
          writeChunk(response, {
            type: 'tool-input-available',
            toolCallId,
            toolName: 'apply_patch',
            input: {
              operation: applyPatchOperation,
              path: `${toolCallId}.txt`,
              content: `content for ${toolCallId}`,
            },
          });
        }

        writeChunk(response, { type: 'finish-step' });
        writeChunk(response, { type: 'finish', finishReason: 'tool-calls' });
        response.end();
        return;
      }

      const assistantMessage = body.messages.find(
        (message: UIMessage) => message.role === 'assistant',
      ) as UIMessage | undefined;
      const applyPatchParts = assistantMessage?.parts.filter(
        part => part.type === 'tool-apply_patch',
      );

      const missingOutputs = toolCallIds.filter(toolCallId => {
        const part = applyPatchParts?.find(
          (candidate: any) => candidate.toolCallId === toolCallId,
        ) as any;
        return (
          part == null ||
          (part.state !== 'output-available' && part.state !== 'output-error') ||
          (part.state === 'output-available' && !('output' in part)) ||
          (part.state === 'output-error' && !('errorText' in part))
        );
      });

      if (missingOutputs.length > 0) {
        writeChunk(response, {
          type: 'error',
          errorText: `No tool output found for apply patch call ${missingOutputs[0]}.`,
        });
        response.end();
        return;
      }

      secondRequestSawAllOutputs = true;
      secondRequestModelMessages = await convertToModelMessages(body.messages);

      writeChunk(response, { type: 'start' });
      writeChunk(response, { type: 'start-step' });
      writeChunk(response, { type: 'text-start', id: 'answer' });
      writeChunk(response, {
        type: 'text-delta',
        id: 'answer',
        delta: 'All apply_patch outputs were present.',
      });
      writeChunk(response, { type: 'text-end', id: 'answer' });
      writeChunk(response, { type: 'finish-step' });
      writeChunk(response, { type: 'finish', finishReason: 'stop' });
      response.end();
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end(error instanceof Error ? error.stack : String(error));
    }
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('Expected the reproduction server to listen on a TCP port.');
  }

  const toolOutputPromises: Promise<unknown>[] = [];
  let chat!: TestChat;

  chat = new TestChat({
    id: 'issue-11267',
    generateId: (() => {
      let id = 0;
      return () => `message-${id++}`;
    })(),
    transport: new DefaultChatTransport({
      api: `http://127.0.0.1:${address.port}/api/chat`,
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName !== 'apply_patch') return;

      await delay(20);

      const addOutputPromise = chat.addToolResult({
        tool: 'apply_patch',
        toolCallId: toolCall.toolCallId,
        output: {
          ok: true,
          path: (toolCall.input as any).path,
        },
      });
      toolOutputPromises.push(Promise.resolve(addOutputPromise));
    },
  });

  try {
    await chat.sendMessage({ text: 'Create several files with apply_patch.' });
    await Promise.all(toolOutputPromises);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }

  if (chat.status === 'error') {
    throw chat.error ?? new Error('Chat entered error state without an error object.');
  }

  if (requests.length !== 2) {
    throw new Error(`Expected exactly 2 requests, received ${requests.length}.`);
  }

  if (!secondRequestSawAllOutputs) {
    throw new Error('The follow-up request did not include all tool outputs.');
  }

  const assistantWithToolOutputs = requests[1].messages.find(
    (message: UIMessage) => message.role === 'assistant',
  ) as UIMessage | undefined;
  const outputSummary = assistantWithToolOutputs?.parts
    .filter((part: any) => part.type === 'tool-apply_patch')
    .map((part: any) => ({
      toolCallId: part.toolCallId,
      state: part.state,
      hasOutput: 'output' in part || 'errorText' in part,
    }));

  console.log(
    JSON.stringify(
      {
        status: chat.status,
        requestCount: requests.length,
        outputSummary,
        modelMessages: secondRequestModelMessages,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
