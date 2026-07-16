import { readFile } from 'node:fs/promises';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, isStepCount, streamText, tool, type ToolSet } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

const serverToolCallId = 'srvtoolu_01FvCG2mjosttzrL4Lnb5mHy';
const deferredServerToolCallId = 'srvtoolu_01Issue17366Deferred';
const clientToolCallId = 'toolu_01Issue17366ClientTool';

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 20,
    text: 20,
    reasoning: undefined,
  },
};

type Fixture = {
  response: {
    status: number;
    body: {
      error: {
        message: string;
      };
    };
  };
};

type RequestBody = {
  messages?: Array<{
    role?: string;
    content?: Array<Record<string, unknown>> | string;
  }>;
};

type ScenarioResult = {
  error: string;
  request: RequestBody | undefined;
  hasServerToolUse: boolean;
  hasServerToolResult: boolean;
  hasOrphanedClientToolResult: boolean;
};

function inspectRequest(request: RequestBody | undefined) {
  const content = request?.messages?.flatMap(message =>
    Array.isArray(message.content) ? message.content : [],
  );

  return {
    hasServerToolUse:
      content?.some(
        part =>
          part.type === 'server_tool_use' &&
          part.id === serverToolCallId &&
          part.name === 'web_search',
      ) === true,
    hasServerToolResult:
      content?.some(
        part =>
          part.type === 'web_search_tool_result' &&
          part.tool_use_id === serverToolCallId,
      ) === true,
    hasOrphanedClientToolResult:
      request?.messages?.some(
        message =>
          message.role === 'user' &&
          Array.isArray(message.content) &&
          message.content.some(
            part =>
              part.type === 'tool_result' &&
              part.tool_use_id === serverToolCallId,
          ),
      ) === true,
  };
}

function createTools(anthropic: ReturnType<typeof createAnthropic>): ToolSet {
  return {
    web_search: anthropic.tools.webSearch_20250305(),
    client_tool: tool({
      inputSchema: z.object({}),
      execute: async () => 'client tool completed',
    }),
  };
}

function createGenerateModel() {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: 'tool-call',
          toolCallId: serverToolCallId,
          toolName: 'web_search',
          input: '{}',
          providerExecuted: true,
        },
        {
          type: 'tool-result',
          toolCallId: serverToolCallId,
          toolName: 'web_search',
          result: {
            type: 'web_search_tool_result_error',
            errorCode: 'invalid_tool_input',
          },
          isError: true,
          providerExecuted: true,
        },
        {
          type: 'tool-call',
          toolCallId: clientToolCallId,
          toolName: 'client_tool',
          input: '{}',
        },
        {
          type: 'tool-call',
          toolCallId: deferredServerToolCallId,
          toolName: 'web_search',
          input: '{"query":"continue after the client tool"}',
          providerExecuted: true,
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_use' },
      usage,
      warnings: [],
    }),
  });
}

function createStreamModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        {
          type: 'tool-call',
          toolCallId: serverToolCallId,
          toolName: 'web_search',
          input: '{}',
          providerExecuted: true,
        },
        {
          type: 'tool-result',
          toolCallId: serverToolCallId,
          toolName: 'web_search',
          result: {
            type: 'web_search_tool_result_error',
            errorCode: 'invalid_tool_input',
          },
          isError: true,
          providerExecuted: true,
        },
        {
          type: 'tool-call',
          toolCallId: clientToolCallId,
          toolName: 'client_tool',
          input: '{}',
        },
        {
          type: 'tool-call',
          toolCallId: deferredServerToolCallId,
          toolName: 'web_search',
          input: '{"query":"continue after the client tool"}',
          providerExecuted: true,
        },
        {
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage,
        },
      ]),
    }),
  });
}

function createFixtureProvider(fixture: Fixture) {
  let request: RequestBody | undefined;

  const anthropic = createAnthropic({
    apiKey: 'fixture-api-key',
    fetch: async (_input, init) => {
      request =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as RequestBody)
          : undefined;

      return new Response(JSON.stringify(fixture.response.body), {
        status: fixture.response.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  return {
    anthropic,
    getRequest: () => request,
  };
}

async function runGenerateScenario(fixture: Fixture): Promise<ScenarioResult> {
  const provider = createFixtureProvider(fixture);
  let error = '';

  try {
    await generateText({
      model: provider.anthropic('claude-sonnet-4-6'),
      prompt: 'Use web search and the client tool.',
      tools: createTools(provider.anthropic),
      stopWhen: isStepCount(2),
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0 ? { model: createGenerateModel() } : undefined,
    });
  } catch (caught) {
    error = String(caught);
  }

  return {
    error,
    request: provider.getRequest(),
    ...inspectRequest(provider.getRequest()),
  };
}

async function runStreamScenario(fixture: Fixture): Promise<ScenarioResult> {
  const provider = createFixtureProvider(fixture);
  let error = '';

  try {
    const result = streamText({
      model: provider.anthropic('claude-sonnet-4-6'),
      prompt: 'Use web search and the client tool.',
      tools: createTools(provider.anthropic),
      stopWhen: isStepCount(2),
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0 ? { model: createStreamModel() } : undefined,
      onError: event => {
        error = String(event.error);
      },
    });

    await result.text;
  } catch (caught) {
    error = String(caught);
  }

  return {
    error,
    request: provider.getRequest(),
    ...inspectRequest(provider.getRequest()),
  };
}

async function main() {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        '../../../../packages/anthropic/src/__fixtures__/anthropic-issue-17366-orphan-tool-result.1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as Fixture;

  const generateTextResult = await runGenerateScenario(fixture);
  const streamTextResult = await runStreamScenario(fixture);
  const expectedError = fixture.response.body.error.message;

  console.log(
    JSON.stringify(
      {
        expectedAnthropicError: expectedError,
        generateText: generateTextResult,
        streamText: streamTextResult,
      },
      null,
      2,
    ),
  );

  for (const [name, result] of [
    ['generateText', generateTextResult],
    ['streamText', streamTextResult],
  ] as const) {
    if (
      !result.hasServerToolUse ||
      !result.hasServerToolResult ||
      !result.hasOrphanedClientToolResult
    ) {
      throw new Error(
        `${name} did not produce the malformed Anthropic follow-up request reported in issue #17366.`,
      );
    }

    if (!result.error.includes(expectedError)) {
      throw new Error(
        `${name} did not surface the recorded Anthropic 400 for the malformed follow-up request.`,
      );
    }
  }

  throw new Error(`Reproduced issue #17366: ${expectedError}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
