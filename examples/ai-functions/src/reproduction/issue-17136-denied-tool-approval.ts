import {
  AbstractChat,
  type ChatInit,
  type ChatState,
  type ChatStatus,
  type ChatTransport,
  DirectChatTransport,
  isToolUIPart,
  ToolLoopAgent,
  type ToolUIPart,
  type UIMessage,
  type UIMessageChunk,
  tool,
} from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

const failureSignal =
  'ISSUE #17136 REPRODUCED: denied tool part remained approval-responded after resubmission; expected output-denied';

class MemoryChatState implements ChatState<UIMessage> {
  status: ChatStatus = 'ready';
  error: Error | undefined;
  messages: UIMessage[] = [];

  pushMessage = (message: UIMessage) => {
    this.messages.push(message);
  };

  popMessage = () => {
    this.messages.pop();
  };

  replaceMessage = (index: number, message: UIMessage) => {
    this.messages[index] = message;
  };

  snapshot = <T>(value: T): T => structuredClone(value);
}

class MemoryChat extends AbstractChat<UIMessage> {
  constructor(init: ChatInit<UIMessage>) {
    super({ ...init, state: new MemoryChatState() });
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

function textResponse(text: string) {
  return [
    { type: 'text-start' as const, id: 'text-1' },
    { type: 'text-delta' as const, id: 'text-1', delta: text },
    { type: 'text-end' as const, id: 'text-1' },
    {
      type: 'finish' as const,
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: usage(),
    },
  ];
}

function toolCallResponse() {
  return [
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
  ];
}

function findToolPart(messages: UIMessage[]): ToolUIPart | undefined {
  for (const part of messages.flatMap(message => message.parts)) {
    if (
      isToolUIPart(part) &&
      part.type === 'tool-delete_file' &&
      part.toolCallId === 'call-1'
    ) {
      return part;
    }
  }

  return undefined;
}

async function runScenario(approved: boolean) {
  let modelSawExecutionDenied = false;
  const onFinishSnapshots: UIMessage[][] = [];
  const wireChunksByRequest: UIMessageChunk[][] = [];

  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const serializedPrompt = JSON.stringify(prompt);
      modelSawExecutionDenied ||= serializedPrompt.includes('execution-denied');

      const responseParts = serializedPrompt.includes('execution-denied')
        ? textResponse('Understood, I will not delete the file.')
        : serializedPrompt.includes('deleted /tmp/x')
          ? textResponse('The file was deleted.')
          : toolCallResponse();

      return {
        stream: convertArrayToReadableStream([
          { type: 'stream-start' as const, warnings: [] },
          {
            type: 'response-metadata' as const,
            id: 'response-1',
            modelId: 'mock-model',
            timestamp: new Date(0),
          },
          ...responseParts,
        ]),
      };
    },
  });

  const agent = new ToolLoopAgent({
    model,
    tools: {
      delete_file: tool({
        description: 'Delete a file',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => `deleted ${path}`,
      }),
    },
    toolApproval: { delete_file: 'user-approval' },
  });

  const directTransport = new DirectChatTransport({ agent });
  const recordingTransport: ChatTransport<UIMessage> = {
    sendMessages: async options => {
      const chunks: UIMessageChunk[] = [];
      wireChunksByRequest.push(chunks);
      const stream = await directTransport.sendMessages(
        options as Parameters<typeof directTransport.sendMessages>[0],
      );

      return stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            chunks.push(structuredClone(chunk));
            controller.enqueue(chunk);
          },
        }),
      );
    },
    reconnectToStream: async () => null,
  };

  const chat = new MemoryChat({
    transport: recordingTransport,
    onFinish: ({ messages }) => {
      onFinishSnapshots.push(structuredClone(messages));
    },
  });

  await chat.sendMessage({ text: 'Please delete /tmp/x' });
  const stateAfterTurn1 = findToolPart(chat.messages)?.state;
  const approvalId = findToolPart(chat.messages)?.approval?.id;
  if (approvalId == null) {
    throw new Error('Reproduction setup failed: approval id was not emitted');
  }

  await chat.addToolApprovalResponse({
    id: approvalId,
    approved,
    reason: approved ? 'user approved' : 'user declined',
  });
  const stateAfterResponse = findToolPart(chat.messages)?.state;

  await chat.sendMessage();

  return {
    stateAfterTurn1,
    stateAfterResponse,
    finalState: findToolPart(chat.messages)?.state,
    persistedFinalState: findToolPart(onFinishSnapshots.at(-1) ?? [])?.state,
    secondRequestWireChunks: wireChunksByRequest.at(-1) ?? [],
    modelSawExecutionDenied,
    finalText: chat.messages
      .at(-1)
      ?.parts.filter(part => part.type === 'text')
      .map(part => part.text)
      .join(''),
  };
}

async function main() {
  const denied = await runScenario(false);
  const approved = await runScenario(true);

  console.log('denied scenario:', JSON.stringify(denied, null, 2));
  console.log('approved final state:', approved.finalState);

  if (denied.stateAfterTurn1 !== 'approval-requested') {
    throw new Error(
      `Reproduction setup failed: first state was ${denied.stateAfterTurn1}`,
    );
  }
  if (denied.stateAfterResponse !== 'approval-responded') {
    throw new Error(
      `Reproduction setup failed: local denial state was ${denied.stateAfterResponse}`,
    );
  }
  if (!denied.modelSawExecutionDenied) {
    throw new Error(
      'Reproduction setup failed: model did not receive execution-denied',
    );
  }
  if (denied.finalText !== 'Understood, I will not delete the file.') {
    throw new Error(
      `Reproduction setup failed: model response was ${denied.finalText}`,
    );
  }
  if (approved.finalState !== 'output-available') {
    throw new Error(
      `Control failed: approved tool state was ${approved.finalState}`,
    );
  }

  const emittedDeniedChunk = denied.secondRequestWireChunks.some(
    chunk => chunk.type === 'tool-output-denied',
  );

  if (
    denied.finalState === 'approval-responded' &&
    denied.persistedFinalState === 'approval-responded' &&
    !emittedDeniedChunk
  ) {
    throw new Error(failureSignal);
  }

  if (denied.finalState !== 'output-denied') {
    throw new Error(
      `Unexpected denied tool state: ${denied.finalState}; expected output-denied`,
    );
  }

  console.log('Issue #17136 did not reproduce.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
