import * as fs from 'node:fs';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { expect, it } from 'vitest';
import { createGoogle } from './google-provider';

const TEST_PROMPT: LanguageModelV4Prompt = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: "use code execution to execute:\nprint('ok')\nprint(1/0)",
      },
    ],
  },
];

it('associates multiple code execution results with the same tool call', async () => {
  const response = fs.readFileSync(
    'src/__fixtures__/google-code-execution-multiple-results.json',
    'utf8',
  );

  const provider = createGoogle({
    apiKey: 'test-api-key',
    generateId: () => 'test-id',
    fetch: async () =>
      new Response(response, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  const model = provider.languageModel('gemini-3-flash-preview');
  const { content } = await model.doGenerate({
    tools: [
      {
        type: 'provider',
        id: 'google.code_execution',
        name: 'code_execution',
        args: {},
      },
    ],
    prompt: TEST_PROMPT,
  });

  expect(
    content
      .filter(part => part.type === 'tool-result')
      .map(part => part.toolCallId),
  ).toEqual(['test-id', 'test-id']);
});
