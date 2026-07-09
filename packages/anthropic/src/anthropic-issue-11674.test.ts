import { type LanguageModelV4Prompt } from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAnthropic } from './anthropic-provider';

vi.mock('./version', () => ({
  VERSION: '0.0.0-test',
}));

const TEST_PROMPT: LanguageModelV4Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Say hello!' }] },
];

const provider = createAnthropic({
  apiKey: 'test-api-key',
});

describe('Anthropic issue 11674', () => {
  const server = createTestServer({
    'https://api.anthropic.com/v1/messages': {},
  });

  function prepareChunksFixtureResponse(filename: string) {
    const chunks = fs
      .readFileSync(`src/__fixtures__/${filename}.chunks.txt`, 'utf8')
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => `data: ${line}\n\n`);
    chunks.push('data: [DONE]\n\n');

    server.urls['https://api.anthropic.com/v1/messages'].response = {
      type: 'stream-chunks',
      chunks,
    };
  }

  it('should support forced tools with empty parameters in streaming', async () => {
    prepareChunksFixtureResponse(
      'anthropic-issue-11674-empty-schema-forced-tool-call.1',
    );

    const result = await provider('claude-haiku-4-5').doStream({
      tools: [
        {
          type: 'function',
          name: 'sayHello',
          description: 'Say hello',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
        },
      ],
      toolChoice: {
        type: 'tool',
        toolName: 'sayHello',
      },
      prompt: TEST_PROMPT,
    });

    expect(await server.calls[0].requestBodyJson).toMatchObject({
      model: 'claude-haiku-4-5',
      stream: true,
      tool_choice: {
        type: 'tool',
        name: 'sayHello',
      },
      tools: [
        expect.objectContaining({
          name: 'sayHello',
          input_schema: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
            $schema: 'http://json-schema.org/draft-07/schema#',
          },
        }),
      ],
    });

    await expect(convertReadableStreamToArray(result.stream)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool-input-start',
          id: expect.any(String),
          toolName: 'sayHello',
        }),
        expect.objectContaining({
          type: 'tool-input-end',
          id: expect.any(String),
        }),
        expect.objectContaining({
          type: 'tool-call',
          toolCallId: expect.any(String),
          toolName: 'sayHello',
          input: '{}',
        }),
        expect.objectContaining({
          type: 'finish',
          finishReason: {
            raw: 'tool_use',
            unified: 'tool-calls',
          },
        }),
      ]),
    );
  });
});
