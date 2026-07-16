import {
  createOpenAI,
  VERSION,
} from '../../../../packages/openai/dist/index.mjs';

type OpenAIRequest = {
  messages: Array<{
    role: string;
    content?: unknown;
    tool_calls?: unknown[];
  }>;
};

async function main() {
  let request: OpenAIRequest | undefined;

  const provider = createOpenAI({
    apiKey: 'test-api-key',
    baseURL: 'http://local.test/v1',
    fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body)) as OpenAIRequest;

      return new Response(
        JSON.stringify({
          id: 'chatcmpl-reproduction',
          object: 'chat.completion',
          created: 1,
          model: 'qwen3-coder:latest',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'File created.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      );
    },
  });

  await provider.chat('qwen3-coder:latest').doGenerate({
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Inspect the workspace.' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'lookup',
            input: { path: '.' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'lookup',
            output: { type: 'text', value: 'README.md' },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Now create the file.' }],
      },
    ],
  });

  const assistantToolCallMessage = request?.messages.find(
    message =>
      message.role === 'assistant' &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length > 0,
  );
  const observedContent = assistantToolCallMessage?.content;

  console.log(
    JSON.stringify(
      {
        openaiProviderVersion: VERSION,
        expectedAssistantToolCallContent: 'null or omitted',
        observedAssistantToolCallContent: observedContent,
      },
      null,
      2,
    ),
  );

  if (assistantToolCallMessage == null) {
    throw new Error(
      'REPRODUCTION_HARNESS_ERROR: assistant tool-call message was not sent',
    );
  }

  if (observedContent !== null && observedContent !== undefined) {
    throw new Error(
      `ISSUE_12389_REPRODUCED: tool-call-only assistant content was ${JSON.stringify(
        observedContent,
      )} instead of null`,
    );
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
