import 'dotenv/config';
import { createAnthropic } from '@ai-sdk/anthropic';
import { Output, streamText, tool } from 'ai';
import { z } from 'zod';

type AnthropicRequest = {
  tool_choice?: {
    type?: string;
    disable_parallel_tool_use?: boolean;
  };
};

async function main() {
  let requestBody: AnthropicRequest | undefined;

  const anthropic = createAnthropic({
    fetch: async (input, init) => {
      if (typeof init?.body === 'string') {
        requestBody = JSON.parse(init.body) as AnthropicRequest;
      }

      return fetch(input, init);
    },
  });

  const result = streamText({
    model: anthropic('claude-sonnet-4-5'),
    maxOutputTokens: 1024,
    output: Output.object({
      schema: z.object({ items: z.array(z.string()) }),
    }),
    tools: {
      searchDocs: tool({
        description:
          'Search documentation. Call this once for each requested query.',
        inputSchema: z.object({ query: z.string() }),
      }),
    },
    providerOptions: {
      anthropic: {
        structuredOutputMode: 'jsonTool',
        disableParallelToolUse: false,
      },
    },
    prompt:
      'Call searchDocs exactly 3 times in parallel in this response, with the distinct queries alpha, beta, and gamma. Do not call the json tool yet.',
  });

  const searchCalls: string[] = [];

  for await (const chunk of result.fullStream) {
    if (chunk.type === 'tool-call' && chunk.toolName === 'searchDocs') {
      searchCalls.push((chunk.input as { query: string }).query);
    }
  }

  const serializedValue = requestBody?.tool_choice?.disable_parallel_tool_use;

  console.log(
    JSON.stringify({
      requestedDisableParallelToolUse: false,
      serializedDisableParallelToolUse: serializedValue,
      searchCalls,
    }),
  );

  if (serializedValue !== false || searchCalls.length !== 3) {
    throw new Error(
      'BUG: disableParallelToolUse:false did not allow three parallel searchDocs calls with structuredOutputMode:jsonTool',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
