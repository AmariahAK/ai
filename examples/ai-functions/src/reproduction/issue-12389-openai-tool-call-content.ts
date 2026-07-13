import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

type ChatMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown[];
};

type ChatRequest = {
  messages?: ChatMessage[];
};

function completion({
  requestNumber,
  content,
  toolCall,
}: {
  requestNumber: number;
  content: string | null;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
}) {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-issue-12389-${requestNumber}`,
      object: 'chat.completion',
      created: 1,
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
                        arguments: JSON.stringify(toolCall.arguments),
                      },
                    },
                  ],
                }),
          },
          finish_reason: toolCall == null ? 'stop' : 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }),
    {
      headers: { 'content-type': 'application/json' },
    },
  );
}

async function main() {
  const requests: ChatRequest[] = [];

  const openai = createOpenAI({
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    fetch: async (_input, init) => {
      if (typeof init?.body !== 'string') {
        throw new Error('Expected a JSON request body.');
      }

      const request = JSON.parse(init.body) as ChatRequest;
      requests.push(request);

      if (requests.length === 1) {
        return completion({
          requestNumber: 1,
          content: null,
          toolCall: {
            id: 'call_lookup',
            name: 'lookup',
            arguments: { path: 'notes.txt' },
          },
        });
      }

      if (requests.length === 2) {
        const previousToolCallMessage = request.messages?.find(
          message =>
            message.role === 'assistant' &&
            Array.isArray(message.tool_calls) &&
            message.tool_calls.length > 0,
        );

        // Model the qwen3-coder behavior reported in issue #12389: an empty
        // string switches the next tool call to text markup, while null keeps
        // the structured OpenAI tool-calling flow.
        if (previousToolCallMessage?.content === '') {
          return completion({
            requestNumber: 2,
            content:
              '<function=write_file>{"path":"notes.txt","content":"done"}</function>',
          });
        }

        return completion({
          requestNumber: 2,
          content: null,
          toolCall: {
            id: 'call_write_file',
            name: 'write_file',
            arguments: { path: 'notes.txt', content: 'done' },
          },
        });
      }

      return completion({
        requestNumber: 3,
        content: 'File created.',
      });
    },
  });

  const result = await generateText({
    model: openai.chat('qwen3-coder:latest'),
    prompt: 'Check notes.txt, then create it with the content "done".',
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
          content,
          created: true,
        }),
      }),
    },
    stopWhen: stepCountIs(3),
  });

  const secondRequestAssistantToolCall = requests[1]?.messages?.find(
    message =>
      message.role === 'assistant' &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length > 0,
  );
  const thirdRequestAssistantToolCalls =
    requests[2]?.messages?.filter(
      message =>
        message.role === 'assistant' &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0,
    ) ?? [];

  const output = {
    requestCount: requests.length,
    expectedAssistantToolCallContent: null,
    observedAssistantToolCallContent:
      secondRequestAssistantToolCall == null
        ? 'missing'
        : secondRequestAssistantToolCall.content,
    thirdRequestAssistantToolCallContents: thirdRequestAssistantToolCalls.map(
      message => message.content,
    ),
    finalText: result.text,
    reproducesIssue12389:
      secondRequestAssistantToolCall?.content === '' ||
      result.text.includes('<function='),
  };

  console.log(JSON.stringify(output, null, 2));

  if (secondRequestAssistantToolCall?.content === '') {
    throw new Error(
      'Reproduced issue #12389: a tool-call-only assistant message was sent with content: "".',
    );
  }

  if (secondRequestAssistantToolCall?.content !== null) {
    throw new Error(
      'Expected the tool-call-only assistant message to use content: null.',
    );
  }

  if (
    thirdRequestAssistantToolCalls.length !== 2 ||
    thirdRequestAssistantToolCalls.some(message => message.content !== null)
  ) {
    throw new Error(
      'Expected both tool-call-only assistant messages in the third request to use content: null.',
    );
  }

  if (requests.length !== 3 || result.text !== 'File created.') {
    throw new Error(
      'Expected structured multi-step tool calling to continue through the final response.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
