import { createAnthropic } from '@ai-sdk/anthropic';
import { Output, streamText, tool } from 'ai';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

type AnthropicRequestBody = {
  tool_choice?: {
    disable_parallel_tool_use?: boolean;
  };
};

async function loadLiveResponseFixture(disableParallelToolUse: boolean) {
  const filename = disableParallelToolUse
    ? 'anthropic-issue-15652.chunks.txt'
    : 'anthropic-issue-15652-false.chunks.txt';
  const chunks = await readFile(
    new URL(
      `../../../../packages/anthropic/src/__fixtures__/${filename}`,
      import.meta.url,
    ),
    'utf8',
  );

  return `${chunks
    .trim()
    .split('\n')
    .map(line => `data: ${line}\n\n`)
    .join('')}data: [DONE]\n\n`;
}

async function main() {
  let requestBody: AnthropicRequestBody | undefined;

  const anthropic = createAnthropic({
    apiKey: 'test-api-key',
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as AnthropicRequestBody;
      const disableParallelToolUse =
        requestBody.tool_choice?.disable_parallel_tool_use === true;

      return new Response(
        await loadLiveResponseFixture(disableParallelToolUse),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    },
  });

  const result = streamText({
    model: anthropic('claude-sonnet-4-5'),
    tools: {
      searchDocs: tool({
        description: 'Search documentation for one query.',
        inputSchema: z.object({ query: z.string() }),
      }),
    },
    output: Output.object({
      schema: z.object({ items: z.array(z.string()) }),
    }),
    providerOptions: {
      anthropic: {
        structuredOutputMode: 'jsonTool',
        disableParallelToolUse: false,
      },
    },
    prompt:
      'Call searchDocs exactly 3 times in parallel in this response, with the distinct queries alpha, beta, and gamma. Do not call the json tool yet.',
  });

  const toolCalls: string[] = [];
  for await (const chunk of result.fullStream) {
    if (chunk.type === 'tool-call') {
      toolCalls.push(chunk.toolName);
    }
  }

  if (toolCalls.length !== 3) {
    console.error(
      'Issue #15652 reproduced: expected 3 parallel searchDocs calls, but received 1 because disable_parallel_tool_use was true.',
    );
    process.exitCode = 1;
    return;
  }

  if (requestBody?.tool_choice?.disable_parallel_tool_use !== false) {
    throw new Error(
      'Expected disableParallelToolUse=false to serialize as disable_parallel_tool_use=false.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
