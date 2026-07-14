import { createOpenAI } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  streamText,
  tool,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const fixturePath = resolve(
  process.cwd(),
  '../../packages/openai/src/responses/__fixtures__/openai-issue-14428-denied-tool-approval.chunks.txt',
);

function extractResponseEvents(responseBody: string): string {
  return responseBody
    .split('\n')
    .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map(line => line.slice('data: '.length))
    .join('\n');
}

async function main() {
  let providerRequest: unknown;
  let providerResponseStatus: number | undefined;
  let providerResponseBody: string | undefined;
  let sendEmailExecutions = 0;

  const openai = createOpenAI({
    fetch: async (input, init) => {
      if (
        String(input).endsWith('/v1/responses') &&
        typeof init?.body === 'string'
      ) {
        providerRequest = JSON.parse(init.body);
      }

      const response = await fetch(input, init);

      if (String(input).endsWith('/v1/responses')) {
        providerResponseStatus = response.status;
        providerResponseBody = await response.clone().text();
      }

      return response;
    },
  });

  const tools = {
    searchMemory: tool({
      description: 'Search memory',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ resultCount: 0, query }),
    }),
    sendEmail: tool({
      description: 'Send an email',
      inputSchema: z.object({
        to: z.string(),
        subject: z.string(),
        body: z.string(),
      }),
      needsApproval: true,
      execute: async ({ to, subject }) => {
        sendEmailExecutions++;
        return { success: true, to, subject };
      },
    }),
  };

  const uiMessages: UIMessage[] = [
    {
      id: 'msg-1',
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'send an email to test@test.com saying hello',
        },
      ],
    },
    {
      id: 'msg-2',
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchMemory',
          toolCallId: 'call_search_14428',
          state: 'output-available',
          input: { query: 'contact test@test.com' },
          output: { resultCount: 0, query: 'contact test@test.com' },
        },
        {
          type: 'tool-sendEmail',
          toolCallId: 'call_send_14428',
          state: 'approval-responded',
          input: {
            to: 'test@test.com',
            subject: 'Hello',
            body: 'Hello',
          },
          approval: {
            id: 'approval_14428',
            approved: false,
            reason: 'User denied',
          },
        },
      ],
    },
  ];

  const modelMessages = await convertToModelMessages(uiMessages, {
    tools,
    ignoreIncompleteToolCalls: true,
  });

  // ai@6.0.154 did not add this synthetic result in convertToModelMessages.
  // Removing it recreates the exact ModelMessage shape reported in #14428 and
  // verifies whether streamText can still process the denial itself.
  const reportedModelMessages = modelMessages.map(message => {
    if (message.role !== 'tool') {
      return message;
    }

    return {
      ...message,
      content: message.content.filter(
        part =>
          part.type !== 'tool-result' ||
          part.output.type !== 'execution-denied',
      ),
    };
  }) as ModelMessage[];

  const result = streamText({
    model: openai('gpt-4o'),
    instructions:
      'The user denied the sendEmail tool call. Do not call tools again. Briefly acknowledge the denial.',
    messages: reportedModelMessages,
    tools,
    maxRetries: 0,
  });

  const streamParts = [];
  for await (const part of result.fullStream) {
    streamParts.push(part);
  }

  if (providerResponseBody != null && providerResponseStatus === 200) {
    await writeFile(
      fixturePath,
      `${extractResponseEvents(providerResponseBody)}\n`,
    );
  }

  const errors = streamParts.filter(part => part.type === 'error');
  const output = {
    expected:
      'Denying the sendEmail approval continues the conversation without executing the tool or returning an OpenAI input[N].output error.',
    currentConvertedModelMessages: modelMessages,
    reportedAi6ModelMessages: reportedModelMessages,
    providerRequest,
    providerResponseStatus,
    streamParts,
    sendEmailExecutions,
  };

  console.log(JSON.stringify(output, null, 2));

  if (sendEmailExecutions !== 0) {
    throw new Error(
      `Denied sendEmail tool executed ${sendEmailExecutions} time(s).`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Reproduced issue #14428: ${errors
        .map(error => String(error.error))
        .join('; ')}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
