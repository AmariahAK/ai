import { createAnthropic } from '@ai-sdk/anthropic';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  createAgentUIStream,
  readUIMessageStream,
  tool,
  ToolLoopAgent,
  type UIMessage,
} from 'ai';
import { z } from 'zod';

type AnthropicRequest = {
  messages?: Array<{
    role?: string;
    content?: Array<{
      type?: string;
      id?: string;
      tool_use_id?: string;
    }>;
  }>;
};

type ApprovalPart = {
  type: 'tool-createIssue';
  toolCallId: string;
  state: 'approval-requested' | 'approval-responded';
  input: { title: string };
  approval: {
    id: string;
    approved?: boolean;
  };
};

type ReproductionResult = {
  executionCount: number;
  capturedErrors: string[];
  continuationChunks: Array<{ type: string; [key: string]: unknown }>;
  capturedRequests: AnthropicRequest[];
  capturedResponses: string[];
};

export async function runReproduction({
  providerFetch = fetch,
}: {
  providerFetch?: typeof fetch;
} = {}): Promise<ReproductionResult> {
  const capturedRequests: AnthropicRequest[] = [];
  const capturedResponses: string[] = [];
  const capturedErrors: unknown[] = [];
  let executionCount = 0;

  const anthropic = createAnthropic({
    fetch: async (url, options) => {
      capturedRequests.push(
        JSON.parse(options?.body as string) as AnthropicRequest,
      );

      const response = await providerFetch(url, options);
      capturedResponses.push(await response.clone().text());
      return response;
    },
  });

  const createIssue = tool({
    description: 'Create an issue',
    inputSchema: z.object({ title: z.string() }),
    needsApproval: true,
    execute: async ({ title }) => {
      executionCount++;
      return { id: '123', title };
    },
  });

  const agent = new ToolLoopAgent({
    model: anthropic('claude-sonnet-4-5'),
    instructions:
      'When explicitly asked to create an issue, call createIssue exactly once.',
    tools: { createIssue },
  });

  const userMessage = {
    id: 'user-1',
    role: 'user' as const,
    parts: [
      {
        type: 'text' as const,
        text: 'Use createIssue now to create an issue titled "Reproduce issue 13057".',
      },
    ],
  };

  const initialStream = await createAgentUIStream({
    agent,
    uiMessages: [userMessage],
    onError: error => {
      capturedErrors.push(error);
      return error instanceof Error ? error.message : String(error);
    },
  });

  let assistantMessage: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream: initialStream,
    terminateOnError: true,
  })) {
    assistantMessage = message;
  }

  assert.ok(assistantMessage, 'the first stream should produce an assistant');
  assert.equal(assistantMessage.role, 'assistant');

  const approvalPart = assistantMessage.parts.find(
    part =>
      typeof part === 'object' &&
      part != null &&
      'type' in part &&
      part.type === 'tool-createIssue',
  ) as ApprovalPart | undefined;

  assert.ok(approvalPart, 'the first stream should request tool approval');
  assert.equal(approvalPart.state, 'approval-requested');
  assert.equal(executionCount, 0, 'the tool must not execute before approval');

  approvalPart.state = 'approval-responded';
  approvalPart.approval.approved = true;
  const toolCallId = approvalPart.toolCallId;

  const continuationStream = await createAgentUIStream({
    agent,
    uiMessages: [userMessage, assistantMessage],
    onError: error => {
      capturedErrors.push(error);
      return error instanceof Error ? error.message : String(error);
    },
  });

  const continuationChunks = [];
  for await (const chunk of continuationStream) {
    continuationChunks.push(chunk);
  }

  assert.equal(
    executionCount,
    1,
    'the approved tool should execute exactly once',
  );
  assert.equal(
    capturedErrors.length,
    0,
    `the UI streams should not fail: ${capturedErrors.map(String).join(', ')}`,
  );
  assert.ok(
    continuationChunks.some(
      chunk =>
        chunk.type === 'tool-output-available' &&
        chunk.toolCallId === toolCallId,
    ),
    'the UI stream should emit the approved tool output',
  );

  const continuationRequest = capturedRequests.at(-1);
  assert.ok(
    continuationRequest,
    'Anthropic should receive a continuation request',
  );

  const toolUseMessageIndex =
    continuationRequest.messages?.findIndex(message =>
      message.content?.some(
        part => part.type === 'tool_use' && part.id === toolCallId,
      ),
    ) ?? -1;

  assert.notEqual(
    toolUseMessageIndex,
    -1,
    'the Anthropic request should contain the original tool_use',
  );

  const toolResultMessage =
    continuationRequest.messages?.[toolUseMessageIndex + 1];
  assert.ok(
    toolResultMessage?.content?.some(
      part => part.type === 'tool_result' && part.tool_use_id === toolCallId,
    ),
    'Anthropic should receive a matching tool_result immediately after tool_use',
  );

  return {
    executionCount,
    capturedErrors: capturedErrors.map(String),
    continuationChunks,
    capturedRequests,
    capturedResponses,
  };
}

async function main() {
  console.log(JSON.stringify(await runReproduction(), null, 2));
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
