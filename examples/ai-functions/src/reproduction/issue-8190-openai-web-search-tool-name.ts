import assert from 'node:assert/strict';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

async function main() {
  let requestBody: unknown;

  const openai = createOpenAI({
    fetch: async (input, init) => {
      if (
        String(input).endsWith('/responses') &&
        typeof init?.body === 'string'
      ) {
        requestBody = JSON.parse(init.body);
      }

      return fetch(input, init);
    },
  });

  const result = await generateText({
    model: openai.responses('gpt-5-mini'),
    prompt: 'Search the web for the current weather in Tokyo and summarize it.',
    tools: {
      webSearch: openai.tools.webSearchPreview({}),
    },
    toolChoice: {
      type: 'tool',
      toolName: 'webSearch',
    },
    providerOptions: {
      openai: {
        store: false,
        include: ['reasoning.encrypted_content'],
      },
    },
  });

  const toolCallNames = result.toolCalls.map(toolCall => toolCall.toolName);
  const toolResultNames = result.toolResults.map(
    toolResult => toolResult.toolName,
  );

  console.log(
    JSON.stringify(
      {
        requestBody,
        toolCallNames,
        toolResultNames,
        text: result.text,
      },
      null,
      2,
    ),
  );

  assert.ok(
    toolCallNames.length > 0,
    'OpenAI did not call the web search tool.',
  );
  assert.ok(
    toolResultNames.length > 0,
    'OpenAI did not return a web search tool result.',
  );
  assert.deepEqual(
    toolCallNames,
    toolCallNames.map(() => 'webSearch'),
    'Issue #8190 reproduced: tool calls use web_search_preview instead of the tools object key webSearch.',
  );
  assert.deepEqual(
    toolResultNames,
    toolResultNames.map(() => 'webSearch'),
    'Issue #8190 reproduced: tool results use web_search_preview instead of the tools object key webSearch.',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
