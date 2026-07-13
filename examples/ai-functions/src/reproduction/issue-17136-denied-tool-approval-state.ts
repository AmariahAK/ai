import assert from 'node:assert/strict';
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import {
  AbstractChat,
  type ChatInit,
  type ChatState,
  type ChatStatus,
  DirectChatTransport,
  type InferAgentUIMessage,
  ToolLoopAgent,
  tool,
  type UIMessage,
} from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

class InMemoryChatState<
  UI_MESSAGE extends UIMessage,
> implements ChatState<UI_MESSAGE> {
  status: ChatStatus = 'ready';
  error: Error | undefined;
  messages: UI_MESSAGE[] = [];

  pushMessage = (message: UI_MESSAGE) => {
    this.messages.push(message);
  };

  popMessage = () => {
    this.messages.pop();
  };

  replaceMessage = (index: number, message: UI_MESSAGE) => {
    this.messages[index] = message;
  };

  snapshot = <T>(value: T): T => structuredClone(value);
}

class TestChat<UI_MESSAGE extends UIMessage> extends AbstractChat<UI_MESSAGE> {
  constructor(init: ChatInit<UI_MESSAGE>) {
    super({ ...init, state: new InMemoryChatState<UI_MESSAGE>() });
  }
}

function usage() {
  return {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 1,
      text: 1,
      reasoning: undefined,
    },
  };
}

async function main() {
  let modelSawExecutionDenied = false;

  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      modelSawExecutionDenied =
        JSON.stringify(prompt).includes('execution-denied');

      return {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          ...(modelSawExecutionDenied
            ? [
                { type: 'text-start' as const, id: 'text-1' },
                {
                  type: 'text-delta' as const,
                  id: 'text-1',
                  delta: 'Understood, I will not delete the file.',
                },
                { type: 'text-end' as const, id: 'text-1' },
                {
                  type: 'finish' as const,
                  finishReason: { unified: 'stop' as const, raw: 'stop' },
                  usage: usage(),
                },
              ]
            : [
                {
                  type: 'tool-call' as const,
                  toolCallId: 'call-1',
                  toolName: 'delete_file',
                  input: JSON.stringify({ path: '/tmp/x' }),
                },
                {
                  type: 'finish' as const,
                  finishReason: {
                    unified: 'tool-calls' as const,
                    raw: 'tool-calls',
                  },
                  usage: usage(),
                },
              ]),
        ]),
      };
    },
  });

  const agent = new ToolLoopAgent({
    model,
    tools: {
      delete_file: tool({
        description: 'Delete a file.',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => `deleted ${path}`,
      }),
    },
    toolApproval: { delete_file: 'user-approval' },
  });

  const chat = new TestChat<InferAgentUIMessage<typeof agent>>({
    transport: new DirectChatTransport({ agent }),
  });

  await chat.sendMessage({ text: 'Please delete /tmp/x.' });

  const toolPart = chat.messages
    .at(-1)
    ?.parts.find(part => part.type === 'tool-delete_file');

  assert.ok(toolPart?.type === 'tool-delete_file');
  assert.equal(toolPart.state, 'approval-requested');
  assert.ok(toolPart.approval != null);

  await chat.addToolApprovalResponse({
    id: toolPart.approval.id,
    approved: false,
    reason: 'user declined',
  });

  const respondedToolPart = chat.messages
    .at(-1)
    ?.parts.find(part => part.type === 'tool-delete_file');

  assert.ok(respondedToolPart?.type === 'tool-delete_file');
  assert.equal(respondedToolPart.state, 'approval-responded');

  await chat.sendMessage();

  const finalToolPart = chat.messages
    .flatMap(message => message.parts)
    .find(part => part.type === 'tool-delete_file');
  const assistantText = chat.messages
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.parts)
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('');

  console.log(
    JSON.stringify(
      {
        modelSawExecutionDenied,
        finalToolState:
          finalToolPart?.type === 'tool-delete_file'
            ? finalToolPart.state
            : undefined,
        assistantText,
        expectedFinalToolState: 'output-denied',
      },
      null,
      2,
    ),
  );

  assert.equal(modelSawExecutionDenied, true);
  assert.ok(finalToolPart?.type === 'tool-delete_file');
  assert.equal(
    finalToolPart.state,
    'output-denied',
    'A client-denied tool approval should reach the output-denied terminal UI state.',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
