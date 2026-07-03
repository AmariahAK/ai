import { openai } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  generateText,
  tool,
  type UIMessage,
} from 'ai';
import { z } from 'zod';

const model = openai.responses('gpt-4o-mini');

const tools = {
  getLibrary: tool({
    description: 'Get a library.',
    inputSchema: z.object({}),
  }),
};

async function main() {
  if (process.env.OPENAI_API_KEY == null) {
    throw new Error('OPENAI_API_KEY is required to run this reproduction.');
  }

  // First make a real Responses API call that emits a function tool call. This
  // gives the follow-up request a provider item id (`fc_...`) and call id like
  // a persisted OpenAI Responses conversation would have.
  const firstTurn = await generateText({
    model,
    prompt: 'Call getLibrary now.',
    tools,
    toolChoice: { type: 'tool', toolName: 'getLibrary' },
    maxOutputTokens: 20,
  });

  const firstToolCall = firstTurn.response.messages[0]?.content[0];
  if (firstToolCall?.type !== 'tool-call') {
    throw new Error(
      `Expected first turn to contain a tool-call, got: ${JSON.stringify(
        firstTurn.response.messages,
      )}`,
    );
  }

  const toolCallId = firstToolCall.toolCallId;
  const itemId = firstToolCall.providerOptions?.openai?.itemId;

  if (typeof itemId !== 'string') {
    throw new Error(
      `Expected OpenAI Responses itemId on tool call, got: ${JSON.stringify(
        firstToolCall,
      )}`,
    );
  }

  // Simulate persisted/rehydrated UI messages with unique message ids but the
  // same toolCallId and OpenAI itemId on:
  // 1. an approval-requested part and
  // 2. the later output-available part.
  const uiMessages: UIMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Call getLibrary now.' }],
    },
    {
      id: 'assistant-approval-request',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-getLibrary',
          state: 'approval-requested',
          toolCallId,
          input: {},
          callProviderMetadata: { openai: { itemId } },
          approval: { id: 'approval-13307' },
        } as UIMessage['parts'][number],
      ],
    },
    {
      id: 'assistant-tool-output',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-getLibrary',
          state: 'output-available',
          toolCallId,
          input: {},
          output: { library: 'demo' },
          callProviderMetadata: { openai: { itemId } },
          approval: { id: 'approval-13307', approved: true },
        } as UIMessage['parts'][number],
      ],
    },
    {
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'Continue in one short sentence.' }],
    },
  ];

  const modelMessages = await convertToModelMessages(uiMessages);
  const duplicateToolCalls = modelMessages
    .flatMap(message =>
      Array.isArray(message.content) ? message.content : [],
    )
    .filter(
      part =>
        part.type === 'tool-call' &&
        'toolCallId' in part &&
        part.toolCallId === toolCallId,
    );

  console.log(
    JSON.stringify(
      {
        setup: {
          toolCallId,
          itemId,
          duplicateToolCallParts: duplicateToolCalls.length,
        },
      },
      null,
      2,
    ),
  );

  if (duplicateToolCalls.length < 2) {
    throw new Error(
      `The simulated persisted messages did not contain duplicate tool-call parts for ${toolCallId}.`,
    );
  }

  // This is the call reported to fail with OpenAI Responses API 400
  // "Duplicate item found with id fc_...".
  const secondTurn = await generateText({
    model,
    messages: modelMessages,
    tools,
    maxOutputTokens: 30,
  });

  console.log(
    JSON.stringify(
      {
        result: 'OpenAI Responses follow-up call succeeded',
        text: secondTurn.text,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
