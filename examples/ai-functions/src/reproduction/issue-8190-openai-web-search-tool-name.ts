import assert from 'node:assert/strict';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

async function main() {
  let requestBody: unknown;

  const openai = createOpenAI({
    fetch: async (input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return fetch(input, init);
    },
  });

  const result = await generateText({
    model: openai.responses('gpt-5-mini'),
    prompt:
      'Search the web for ai-sdk.dev and reply with the homepage title only.',
    tools: {
      webSearch: openai.tools.webSearchPreview({}),
    },
  });

  const requestTools = (
    requestBody as {
      tools?: Array<{ type?: string }>;
    }
  ).tools;
  const toolCallNames = result.toolCalls.map(toolCall => toolCall.toolName);
  const toolResultNames = result.toolResults.map(
    toolResult => toolResult.toolName,
  );
  console.log(
    JSON.stringify(
      {
        requestTools,
        toolCallNames,
        toolResultNames,
      },
      null,
      2,
    ),
  );

  assert.ok(
    requestTools?.some(tool => tool.type === 'web_search_preview'),
    'OpenAI must receive its provider-defined web_search_preview wire type.',
  );
  assert.ok(toolCallNames.length > 0, 'Expected OpenAI to perform web search.');
  assert.deepEqual(
    [...new Set(toolCallNames)],
    ['webSearch'],
    'AI SDK tool calls must use the tools object key.',
  );
  assert.deepEqual(
    [...new Set(toolResultNames)],
    ['webSearch'],
    'AI SDK tool results must use the tools object key.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
