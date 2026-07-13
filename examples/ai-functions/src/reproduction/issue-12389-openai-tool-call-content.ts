import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

type OpenAIMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string };
  }>;
};

type OpenAIChatRequest = {
  messages?: OpenAIMessage[];
};

function createChatCompletion({
  content,
  finishReason,
  toolCall,
}: {
  content: string;
  finishReason: 'stop' | 'tool_calls';
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
}) {
  return {
    id: `chatcmpl-reproduction-${toolCall?.id ?? 'final'}`,
    object: 'chat.completion',
    created: 1_750_000_000,
    model: 'qwen3-coder:latest',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(toolCall == null
            ? {}
            : {
                tool_calls: [
                  {
                    id: toolCall.id,
                    type: 'function',
                    function: {
                      name: toolCall.name,
                      arguments: toolCall.arguments,
                    },
                  },
                ],
              }),
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  };
}

async function main() {
  const requests: OpenAIChatRequest[] = [];
  const responses = [
    createChatCompletion({
      content: '',
      finishReason: 'tool_calls',
      toolCall: {
        id: 'call_lookup',
        name: 'lookup',
        arguments: '{"path":"demo.txt"}',
      },
    }),
    createChatCompletion({
      content: '',
      finishReason: 'tool_calls',
      toolCall: {
        id: 'call_write_file',
        name: 'write_file',
        arguments: '{"path":"demo.txt","content":"hello"}',
      },
    }),
    createChatCompletion({
      content: 'File created.',
      finishReason: 'stop',
    }),
  ];

  const openai = createOpenAI({
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    fetch: async (_url, options) => {
      if (typeof options?.body !== 'string') {
        throw new Error('Expected the OpenAI request body to be JSON text.');
      }

      requests.push(JSON.parse(options.body) as OpenAIChatRequest);

      const response = responses[requests.length - 1];
      if (response == null) {
        throw new Error('The SDK made more than three requests.');
      }

      return new Response(JSON.stringify(response), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await generateText({
    model: openai.chat('qwen3-coder:latest'),
    prompt: 'Check whether demo.txt exists, then create it.',
    tools: {
      lookup: tool({
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => ({ path, exists: false }),
      }),
      write_file: tool({
        inputSchema: z.object({
          path: z.string(),
          content: z.string(),
        }),
        execute: async ({ path, content }) => ({
          path,
          bytesWritten: content.length,
        }),
      }),
    },
    stopWhen: stepCountIs(3),
  });

  const toolCallOnlyAssistantMessages = new Map<string, OpenAIMessage>();

  for (const request of requests.slice(1)) {
    for (const message of request.messages ?? []) {
      const toolCallId = message.tool_calls?.[0]?.id;
      if (message.role === 'assistant' && toolCallId != null) {
        toolCallOnlyAssistantMessages.set(toolCallId, message);
      }
    }
  }

  const observed = [...toolCallOnlyAssistantMessages.values()].map(message => ({
    content: message.content,
    toolCallId: message.tool_calls?.[0]?.id,
    toolName: message.tool_calls?.[0]?.function?.name,
  }));

  console.log(
    JSON.stringify(
      {
        requestCount: requests.length,
        finalText: result.text,
        expectedAssistantToolCallContent: null,
        observedAssistantToolCallMessages: observed,
        reproducesIssue12389: observed.some(message => message.content === ''),
      },
      null,
      2,
    ),
  );

  const invalidMessage = observed.find(message => message.content !== null);
  if (invalidMessage != null) {
    throw new Error(
      `Expected tool-call-only assistant content to be null, received ${JSON.stringify(invalidMessage.content)}.`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
