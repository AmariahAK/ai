import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGoogleGenerativeAI } from './google-provider';

const response = JSON.parse(
  readFileSync(
    new URL(
      './__fixtures__/google-code-execution-multiple-results.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

describe('issue #11485', () => {
  it('associates every code execution result with its executable code', async () => {
    const google = createGoogleGenerativeAI({
      apiKey: 'test-api-key',
      generateId: () => 'code-execution-call',
      fetch: async () =>
        new Response(JSON.stringify(response), {
          headers: { 'content-type': 'application/json' },
        }),
    });

    const result = await google('gemini-3-flash-preview').doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: "use code execution to execute the following code snippet:\nprint('ok')\nprint(1/0)",
            },
          ],
        },
      ],
      tools: [
        {
          type: 'provider',
          id: 'google.code_execution',
          name: 'code_execution',
          args: {},
        },
      ],
    });

    expect(
      result.content
        .filter(part => part.type === 'tool-result')
        .map(part => part.toolCallId),
    ).toEqual(['code-execution-call', 'code-execution-call']);
  });
});
