import 'dotenv/config';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import fs from 'node:fs/promises';

const fixtureUrl = new URL(
  '../../../../packages/anthropic/src/__fixtures__/anthropic-tool-choice-none-history.json',
  import.meta.url,
);

async function main() {
  let requestBody: unknown;
  let responseBody: unknown;
  let responseText: string | undefined;

  const anthropic = createAnthropic({
    fetch: async (url, options) => {
      requestBody = JSON.parse(String(options?.body ?? '{}'));

      const response = await fetch(url, options);
      const text = await response.clone().text();
      responseText = text;

      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = text;
      }

      return response;
    },
  });

  const prompt = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Search for climate change.' }],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'toolu_repro_123',
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
          toolCallId: 'toolu_repro_123',
          toolName: 'search',
          output: {
            type: 'text',
            value:
              'Climate change refers to long-term shifts in temperatures and weather patterns.',
          },
        },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Now summarize what you found in one sentence.' },
      ],
    },
  ] satisfies LanguageModelV4Prompt;

  const modelId = process.env.ANTHROPIC_REPRO_MODEL ?? 'claude-haiku-4-5';

  const result = await anthropic(modelId).doGenerate({
    prompt,
    maxOutputTokens: 128,
    tools: [
      {
        type: 'function',
        name: 'search',
        description: 'Search for information',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
      },
    ],
    toolChoice: { type: 'none' },
  });

  await fs.writeFile(fixtureUrl, `${JSON.stringify(responseBody, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        modelId,
        requestHasTools:
          typeof requestBody === 'object' &&
          requestBody !== null &&
          'tools' in requestBody,
        requestToolChoice:
          typeof requestBody === 'object' && requestBody !== null
            ? (requestBody as { tool_choice?: unknown }).tool_choice
            : undefined,
        content: result.content,
        finishReason: result.finishReason,
        usage: result.usage,
        responseBody,
        responseTextLength: responseText?.length,
        fixturePath: fixtureUrl.pathname,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
