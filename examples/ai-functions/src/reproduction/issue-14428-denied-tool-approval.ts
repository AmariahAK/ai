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

  // Preserve the reported ModelMessage shape by removing a synthetic denied
  // result if conversion adds one, then let streamText process the approval.
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
    system:
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
  const assistantText = streamParts
    .flatMap(part => (part.type === 'text-delta' ? [part.text] : []))
    .join('');
  const emittedToolOutputDenied = streamParts.some(
    part =>
      part.type === 'tool-output-denied' &&
      part.toolCallId === 'call_send_14428',
  );
  const providerInput = (
    providerRequest as
      | {
          input?: Array<{
            type?: string;
            call_id?: string;
            output?: unknown;
          }>;
        }
      | undefined
  )?.input;
  const sentDeniedOutput = providerInput?.some(
    item =>
      item.type === 'function_call_output' &&
      item.call_id === 'call_send_14428' &&
      item.output === 'User denied',
  );
  const output = {
    expected:
      'Denying the sendEmail approval continues the conversation without executing the tool or returning an OpenAI input[N].output error.',
    currentConvertedModelMessages: modelMessages,
    reportedAi6ModelMessages: reportedModelMessages,
    providerRequest,
    providerResponseStatus,
    streamParts,
    sendEmailExecutions,
    assistantText,
    emittedToolOutputDenied,
    sentDeniedOutput,
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

  if (!emittedToolOutputDenied) {
    throw new Error('Expected streamText to emit tool-output-denied.');
  }

  if (!sentDeniedOutput) {
    throw new Error(
      'Expected the OpenAI request to include the denied function_call_output.',
    );
  }

  if (assistantText === '') {
    throw new Error(
      'Expected the model to continue with assistant text after the denial.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
