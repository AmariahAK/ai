import { createAnthropic } from '@ai-sdk/anthropic';
import { Output, stepCountIs, streamText, tool } from 'ai';
import fs from 'node:fs/promises';
import { z } from 'zod';

async function main() {
  const fixture = await fs.readFile(
    '../../packages/anthropic/src/__fixtures__/issue-15652.chunks.txt',
    'utf8',
  );
  const requestBodies: Array<Record<string, unknown>> = [];
  const model = createAnthropic({
    apiKey: 'test-api-key',
    fetch: async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        `${fixture
          .trim()
          .split('\n')
          .map(line => `data: ${line}\n\n`)
          .join('')}data: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  })('claude-sonnet-4-5');

  let searchCount = 0;
  const result = streamText({
    model,
    tools: {
      searchDocs: tool({
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => {
          searchCount += 1;
          return { query, result: `Result for ${query}` };
        },
      }),
    },
    experimental_output: Output.object({
      schema: z.object({ items: z.array(z.string()) }),
    }),
    providerOptions: {
      anthropic: {
        structuredOutputMode: 'jsonTool',
        disableParallelToolUse: false,
      },
    },
    stopWhen: stepCountIs(3),
    prompt:
      'Call searchDocs exactly 3 times in parallel with distinct queries, then return the query names as items.',
  });

  for await (const _part of result.fullStream) {
    // Consume the live-provider fixture so tool executions can run.
  }

  const request = requestBodies[0];
  const toolChoice = request.tool_choice as
    | { disable_parallel_tool_use?: boolean }
    | undefined;
  const tools = request.tools as Array<{ name?: string }> | undefined;
  const ignoredOverride = toolChoice?.disable_parallel_tool_use === true;
  const searchToolWasRemoved = !tools?.some(tool => tool.name === 'searchDocs');

  if (ignoredOverride && searchToolWasRemoved && searchCount === 0) {
    throw new Error(
      'ISSUE #15652 REPRODUCED: expected 3 parallel searchDocs calls with disableParallelToolUse=false, but observed 0 calls and serialized disable_parallel_tool_use=true.',
    );
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
