import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createGoogle } from './google-provider';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

describe('issue #11485', () => {
  it('associates multiple code execution results with the preceding tool call', async () => {
    const responseBody = JSON.parse(
      fs.readFileSync(
        'src/__fixtures__/google-code-execution-multiple-results.json',
        'utf8',
      ),
    );
    const provider = createGoogle({
      apiKey: 'test-api-key',
      generateId: () => 'test-id',
      fetch: async () =>
        new Response(JSON.stringify(responseBody), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    });

    const { content } = await provider
      .languageModel('gemini-3-flash-preview')
      .doGenerate({
        tools: [
          {
            type: 'provider',
            id: 'google.code_execution',
            name: 'code_execution',
            args: {},
          },
        ],
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
      });

    expect(
      content
        .filter(part => part.type === 'tool-result')
        .map(part => part.toolCallId),
    ).toEqual(['test-id', 'test-id']);
  });
});
