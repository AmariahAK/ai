import { createOpenAI } from '@ai-sdk/openai';
import { generateText, tool } from 'ai';
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

async function main() {
  const requests: OpenAIChatRequest[] = [];
  const openai = createOpenAI({
    fetch: async (url, options) => {
      if (typeof options?.body === 'string') {
        requests.push(JSON.parse(options.body) as OpenAIChatRequest);
      }

      return fetch(url, options);
    },
  });

  const result = await generateText({
    model: openai.chat('gpt-4o'),
    messages: [
      {
        role: 'user',
        content: 'Check whether demo.txt exists.',
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_lookup',
            toolName: 'lookup',
            input: { path: 'demo.txt' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_lookup',
            toolName: 'lookup',
            output: {
              type: 'json',
              value: { path: 'demo.txt', exists: false },
            },
          },
        ],
      },
      {
        role: 'user',
        content: 'The lookup is complete. Reply exactly: File created.',
      },
    ],
    tools: {
      lookup: tool({
        description: 'Check whether a file exists.',
        inputSchema: z.object({ path: z.string() }),
      }),
    },
    toolChoice: 'none',
    temperature: 0,
  });

  const assistantToolCallMessage = requests[0]?.messages?.find(
    message =>
      message.role === 'assistant' &&
      message.tool_calls?.[0]?.id === 'call_lookup',
  );

  console.log(
    JSON.stringify(
      {
        requestCount: requests.length,
        finalText: result.text,
        expectedAssistantToolCallContent: null,
        observedAssistantToolCallContent: assistantToolCallMessage?.content,
        observedToolName:
          assistantToolCallMessage?.tool_calls?.[0]?.function?.name,
      },
      null,
      2,
    ),
  );

  if (assistantToolCallMessage?.content !== null) {
    throw new Error(
      `Expected tool-call-only assistant content to be null, received ${JSON.stringify(assistantToolCallMessage?.content)}.`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
