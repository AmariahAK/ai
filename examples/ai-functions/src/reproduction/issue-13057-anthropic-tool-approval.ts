import { createAnthropic } from '@ai-sdk/anthropic';
import {
  createAgentUIStream,
  isToolUIPart,
  readUIMessageStream,
  ToolLoopAgent,
  tool,
  type UIMessage,
} from 'ai';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

type AnthropicContentBlock = {
  type?: string;
  id?: string;
  tool_use_id?: string;
};

type AnthropicMessage = {
  role?: string;
  content?: AnthropicContentBlock[];
};

type AnthropicRequest = {
  messages?: AnthropicMessage[];
};

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const values: T[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return values;
    }
    values.push(value);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasImmediateMatchingToolResult(request: AnthropicRequest): boolean {
  const messages = request.messages ?? [];

  for (let index = 0; index < messages.length - 1; index++) {
    const message = messages[index];
    const nextMessage = messages[index + 1];

    if (message.role !== 'assistant' || nextMessage.role !== 'user') {
      continue;
    }

    const toolUseIds = new Set(
      (message.content ?? [])
        .filter(part => part.type === 'tool_use' && part.id != null)
        .map(part => part.id),
    );

    if (
      (nextMessage.content ?? []).some(
        part =>
          part.type === 'tool_result' &&
          part.tool_use_id != null &&
          toolUseIds.has(part.tool_use_id),
      )
    ) {
      return true;
    }
  }

  return false;
}

function toChunksFixture(rawSse: string): string {
  return `${rawSse
    .split(/\r?\n/)
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice('data: '.length))
    .filter(line => line !== '[DONE]')
    .join('\n')}\n`;
}

async function main() {
  const requests: AnthropicRequest[] = [];
  const responseBodies: Array<Promise<string>> = [];

  const anthropic = createAnthropic({
    fetch: async (input, init) => {
      assert(
        typeof init?.body === 'string',
        'Expected Anthropic request body to be JSON text.',
      );
      requests.push(JSON.parse(init.body) as AnthropicRequest);

      const response = await globalThis.fetch(input, init);
      responseBodies.push(response.clone().text());
      return response;
    },
  });

  let executeCount = 0;

  const createIssue = tool({
    description: 'Create an issue with the requested title.',
    inputSchema: z.object({ title: z.string() }),
    needsApproval: true,
    execute: async ({ title }) => {
      executeCount++;
      return { id: '123', title };
    },
  });

  const agent = new ToolLoopAgent({
    model: anthropic('claude-sonnet-4-5'),
    instructions:
      'Call createIssue when the user asks to create an issue. After receiving its result, briefly confirm the created issue.',
    tools: { createIssue },
    prepareCall: options => {
      const hasExistingToolCall =
        Array.isArray(options.prompt) &&
        options.prompt.some(
          message =>
            message.role === 'assistant' &&
            Array.isArray(message.content) &&
            message.content.some(part => part.type === 'tool-call'),
        );

      return {
        ...options,
        toolChoice: hasExistingToolCall
          ? 'none'
          : { type: 'tool', toolName: 'createIssue' },
      };
    },
  });

  const userMessage: UIMessage = {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Create an issue titled Reproduction.' }],
  };

  const firstStream = await createAgentUIStream({
    agent,
    uiMessages: [userMessage],
  });

  let approvalMessage: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream: firstStream })) {
    approvalMessage = message;
  }

  assert(approvalMessage != null, 'First stream did not produce a UI message.');

  const approvalPart = approvalMessage.parts.find(
    part => isToolUIPart(part) && part.state === 'approval-requested',
  );
  assert(
    approvalPart != null && isToolUIPart(approvalPart),
    'First stream did not request tool approval.',
  );

  const approvedMessage = structuredClone(approvalMessage);
  approvedMessage.parts = approvedMessage.parts.map(part =>
    isToolUIPart(part) &&
    part.state === 'approval-requested' &&
    part.approval.id === approvalPart.approval.id
      ? {
          ...part,
          state: 'approval-responded',
          approval: {
            ...part.approval,
            approved: true,
          },
        }
      : part,
  );

  const secondStream = await createAgentUIStream({
    agent,
    uiMessages: [userMessage, approvedMessage],
  });
  const [chunksBranch, messageBranch] = secondStream.tee();

  const chunksPromise = readAll(chunksBranch);
  let finalMessage: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    message: approvedMessage,
    stream: messageBranch,
    terminateOnError: true,
  })) {
    finalMessage = message;
  }
  const chunks = await chunksPromise;

  const errors = chunks.filter(chunk => chunk.type === 'error');
  assert(
    errors.length === 0,
    `Second stream returned an error: ${errors.map(error => error.errorText).join('; ')}`,
  );
  assert(
    executeCount === 1,
    `Expected the approved tool to execute once, but it executed ${executeCount} times.`,
  );
  assert(
    chunks.some(
      chunk =>
        chunk.type === 'tool-output-available' &&
        chunk.toolCallId === approvalPart.toolCallId,
    ),
    'Second stream did not emit tool-output-available for the approved call.',
  );
  assert(
    finalMessage?.parts.some(
      part =>
        isToolUIPart(part) &&
        part.toolCallId === approvalPart.toolCallId &&
        part.state === 'output-available',
    ),
    'The live UI message did not transition the approved tool to output-available.',
  );

  const continuationRequestIndex = requests.findIndex(
    hasImmediateMatchingToolResult,
  );
  assert(
    continuationRequestIndex >= 0,
    'Anthropic did not receive an immediate matching tool_result block.',
  );

  if (process.env.RECORD_FIXTURE === '1') {
    const responses = await Promise.all(responseBodies);
    const fixturePath = fileURLToPath(
      new URL(
        '../../../../packages/anthropic/src/__fixtures__/issue-13057-approved-tool.2.chunks.txt',
        import.meta.url,
      ),
    );
    await writeFile(
      fixturePath,
      toChunksFixture(responses[continuationRequestIndex]),
    );
    console.log(`Recorded fixture: ${fixturePath}`);
  }

  console.log(
    JSON.stringify(
      {
        executeCount,
        streamedToolOutput: true,
        finalToolState: 'output-available',
        anthropicRequestHasImmediateToolResult: true,
        providerRequestCount: requests.length,
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
