import type {
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {
  AbstractChat,
  convertToModelMessages,
  readUIMessageStream,
  streamText,
  tool,
  type ChatInit,
  type ChatState,
  type ChatStatus,
  type UIMessage,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

const usage: LanguageModelV3Usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: 0,
  },
};

function streamFrom(parts: LanguageModelV3StreamPart[]) {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

class MemoryChatState implements ChatState<UIMessage> {
  status: ChatStatus = 'ready';
  error: Error | undefined;

  constructor(public messages: UIMessage[]) {}

  pushMessage = (message: UIMessage) => {
    this.messages = [...this.messages, message];
  };

  popMessage = () => {
    this.messages = this.messages.slice(0, -1);
  };

  replaceMessage = (index: number, message: UIMessage) => {
    this.messages = [
      ...this.messages.slice(0, index),
      message,
      ...this.messages.slice(index + 1),
    ];
  };

  snapshot = <T>(value: T): T => value;
}

class MemoryChat extends AbstractChat<UIMessage> {
  constructor(init: ChatInit<UIMessage>) {
    super({
      ...init,
      state: new MemoryChatState(init.messages ?? []),
    });
  }
}

async function main() {
  const secret = 'issue-17358-secret';
  let executions = 0;
  const tools = {
    myTool: tool({
      inputSchema: z.object({ value: z.string() }),
      needsApproval: true,
      execute: async ({ value }) => {
        executions++;
        return `executed:${value}`;
      },
    }),
  };

  const initialResult = streamText({
    model: new MockLanguageModelV3({
      doStream: async () => ({
        stream: streamFrom([
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'myTool',
            input: JSON.stringify({ value: 'original' }),
          },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
            usage,
          },
        ]),
      }),
    }),
    prompt: 'Call myTool.',
    tools,
    experimental_toolApprovalSecret: secret,
  });

  let assistantMessage: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream: initialResult.toUIMessageStream(),
  })) {
    assistantMessage = message;
  }

  if (assistantMessage == null) {
    throw new Error('Initial stream did not produce an assistant UI message.');
  }

  const requestedPart = assistantMessage.parts.find(
    part => part.type === 'tool-myTool' && part.state === 'approval-requested',
  );
  if (
    requestedPart == null ||
    requestedPart.type !== 'tool-myTool' ||
    requestedPart.state !== 'approval-requested'
  ) {
    throw new Error('Initial stream did not produce an approval request.');
  }

  if (requestedPart.approval.signature == null) {
    throw new Error('Initial approval request did not contain a signature.');
  }
  const originalSignature = requestedPart.approval.signature;

  const chat = new MemoryChat({
    messages: [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Call myTool.' }],
      },
      assistantMessage,
    ],
  });

  await chat.addToolApprovalResponse({
    id: requestedPart.approval.id,
    approved: true,
  });

  const respondedPart = chat.messages[1].parts.find(
    part => part.type === 'tool-myTool',
  );
  if (
    respondedPart == null ||
    respondedPart.type !== 'tool-myTool' ||
    respondedPart.state !== 'approval-responded'
  ) {
    throw new Error('Chat did not record the approval response.');
  }

  const signatureWasPreserved =
    respondedPart.approval.signature === originalSignature;

  const resumedResult = streamText({
    model: new MockLanguageModelV3({
      doStream: async () => ({
        stream: streamFrom([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text-1' },
          {
            type: 'text-delta',
            id: 'text-1',
            delta: 'resume succeeded',
          },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage,
          },
        ]),
      }),
    }),
    messages: await convertToModelMessages(chat.messages),
    tools,
    experimental_toolApprovalSecret: secret,
  });

  let resumedText: string;
  try {
    resumedText = await resumedResult.text;
  } catch (error) {
    if (
      !signatureWasPreserved &&
      error instanceof Error &&
      error.message.includes('missing signature')
    ) {
      throw new Error(
        'ISSUE 17358 REPRODUCED: signed tool approval resume failed with missing signature.',
        { cause: error },
      );
    }
    throw error;
  }

  if (
    !signatureWasPreserved ||
    executions !== 1 ||
    resumedText !== 'resume succeeded'
  ) {
    throw new Error(
      `Signed approval resume failed: signatureWasPreserved=${signatureWasPreserved}, executions=${executions}, text=${JSON.stringify(resumedText)}`,
    );
  }

  console.log(
    'Issue #17358 not reproduced: approval.signature was preserved and the signed approval resumed successfully.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
