import { createOpenAI } from '@ai-sdk/openai';
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';

type ChatMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
};

type ChatRequest = {
  messages?: ChatMessage[];
};

function chatCompletion({
  content,
  finishReason,
  toolCall,
}: {
  content: string | null;
  finishReason: 'stop' | 'tool_calls';
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
}) {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-issue-12389',
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
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
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
    apiKey: 'test',
    baseURL: 'http://issue-12389.test/v1',
    fetch: async (_input, init) => {
      if (typeof init?.body !== 'string') {
        throw new Error('Expected a JSON request body.');
      }

      const request = JSON.parse(init.body) as ChatRequest;
      requests.push(request);

      if (requests.length === 1) {
        return chatCompletion({
          content: null,
          finishReason: 'tool_calls',
          toolCall: {
            id: 'call_lookup',
            name: 'lookup',
            arguments: '{}',
          },
        });
      }

      if (requests.length === 2) {
        const priorToolCallMessage = request.messages?.find(
          message => message.role === 'assistant' && message.tool_calls != null,
        );

        // Model the reported Ollama behavior so the final multi-turn outcome
        // fails if the SDK serializes the prior tool-only turn as content: "".
        if (priorToolCallMessage?.content === '') {
          return chatCompletion({
            content: '<function=writeFile>{"path":"result.txt"}</function>',
            finishReason: 'stop',
          });
        }

        return chatCompletion({
          content: null,
          finishReason: 'tool_calls',
          toolCall: {
            id: 'call_write_file',
            name: 'writeFile',
            arguments: '{"path":"result.txt"}',
          },
        });
      }

      return chatCompletion({
        content: 'File created.',
        finishReason: 'stop',
      });
    },
  });

  const result = await generateText({
    model: openai.chat('qwen3-coder:latest'),
    prompt: 'Look up the project, then create result.txt.',
    tools: {
      lookup: tool({
        inputSchema: z.object({}),
        execute: async () => ({ project: 'ai-sdk' }),
      }),
      writeFile: tool({
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => ({ created: path }),
      }),
    },
    stopWhen: isStepCount(3),
  });

  const secondRequestAssistantMessage = requests[1]?.messages?.find(
    message => message.role === 'assistant' && message.tool_calls != null,
  );
  const secondStepHasStructuredToolCall =
    result.steps[1]?.toolCalls.some(
      toolCall => toolCall.toolName === 'writeFile',
    ) === true;

  const output = {
    requestCount: requests.length,
    expectedAssistantToolCallContent: null,
    observedAssistantToolCallContent:
      secondRequestAssistantMessage?.content ?? null,
    secondStepHasStructuredToolCall,
    finalText: result.text,
    reproducesIssue12389:
      secondRequestAssistantMessage?.content === '' ||
      !secondStepHasStructuredToolCall,
  };

  console.log(JSON.stringify(output, null, 2));

  if (secondRequestAssistantMessage?.content === '') {
    throw new Error(
      'Reproduced issue #12389: the prior tool-call-only assistant message was sent with content: "".',
    );
  }

  if (!secondStepHasStructuredToolCall) {
    throw new Error(
      'Reproduced issue #12389: multi-turn structured tool calling did not continue after a tool-only assistant turn.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
