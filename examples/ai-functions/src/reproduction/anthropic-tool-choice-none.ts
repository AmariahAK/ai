import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  LanguageModelV4FunctionTool,
  LanguageModelV4Prompt,
} from '@ai-sdk/provider';
import { safeParseJSON } from '@ai-sdk/provider-utils';
import { mkdir, writeFile } from 'node:fs/promises';

const fixturePath =
  '../../packages/anthropic/src/__fixtures__/anthropic-tool-choice-none-live.json';

const prompt: LanguageModelV4Prompt = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Search for climate change.',
      },
    ],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'toolu_01ReproToolChoiceNone0000000000',
        toolName: 'search',
        input: { query: 'climate change' },
      },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'toolu_01ReproToolChoiceNone0000000000',
        toolName: 'search',
        output: {
          type: 'text',
          value:
            'Climate change results: global temperatures are rising and mitigation requires lowering greenhouse-gas emissions.',
        },
      },
    ],
  },
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Now summarize what you found in one concise sentence.',
      },
    ],
  },
];

const tools: LanguageModelV4FunctionTool[] = [
  {
    type: 'function',
    name: 'search',
    description: 'Search for information.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

async function main() {
  const requestBodies: unknown[] = [];

  const anthropic = createAnthropic({
    fetch: async (url, options) => {
      const parsedBody = await safeParseJSON({ text: String(options?.body) });
      if (!parsedBody.success) {
        throw parsedBody.error;
      }
      requestBodies.push(parsedBody.value);
      return fetch(url, options);
    },
  });

  const result = await anthropic('claude-sonnet-4-6').doGenerate({
    prompt,
    tools,
    toolChoice: { type: 'none' },
    maxOutputTokens: 64,
  });

  if (result.response == null) {
    throw new Error('Expected an Anthropic response object.');
  }

  await mkdir('../../packages/anthropic/src/__fixtures__', { recursive: true });
  await writeFile(
    fixturePath,
    `${JSON.stringify(result.response.body, null, 2)}\n`,
  );

  const requestBody = requestBodies[0] as Record<string, unknown>;
  const responseBody = result.response.body as
    | { content?: unknown }
    | undefined;
  console.log(
    JSON.stringify(
      {
        model: requestBody.model,
        sentTools: Array.isArray(requestBody.tools),
        sentToolChoice: requestBody.tool_choice ?? null,
        responseContent: responseBody?.content,
        content: result.content,
        finishReason: result.finishReason,
        fixturePath,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
