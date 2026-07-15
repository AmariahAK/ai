import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createOpenAI } from './openai-provider';

const reportedToolCallId =
  'ws_689e2d4880a0819d98acca37694989b00b15d90494fc6b87';

const server = createTestServer({
  'https://api.openai.com/v1/responses': {
    response: {
      type: 'json-value',
      body: JSON.parse(
        fs.readFileSync(
          'src/responses/__fixtures__/issue-8132-web-search-preview.json',
          'utf8',
        ),
      ),
    },
  },
  'https://api.openai.com/v1/chat/completions': {
    response: {
      type: 'json-value',
      body: JSON.parse(
        fs.readFileSync(
          'src/chat/__fixtures__/issue-8132-long-tool-call-id.json',
          'utf8',
        ),
      ),
    },
  },
});

describe('issue #8132', () => {
  it('accepts a web-search tool-call ID longer than 40 characters', async () => {
    const openai = createOpenAI({ apiKey: 'test-api-key' });
    const responsesResult = await openai.responses('gpt-4o-mini').doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Find the title of the official OpenAI API documentation.',
            },
          ],
        },
      ],
      tools: [
        {
          type: 'provider-defined',
          id: 'openai.web_search_preview',
          name: 'web_search_preview',
          args: { searchContextSize: 'low' },
        },
      ],
      toolChoice: {
        type: 'tool',
        toolName: 'web_search_preview',
      },
    });

    const generatedToolCall = responsesResult.content.find(
      part =>
        part.type === 'tool-call' && part.toolName === 'web_search_preview',
    );

    expect(generatedToolCall).toMatchObject({
      type: 'tool-call',
      toolCallId: 'ws_0af1b57ae87e2013006a5745fe6064819ead94dd7bec539ecc',
      providerExecuted: true,
    });

    if (generatedToolCall?.type !== 'tool-call') {
      throw new Error('The fixture did not contain a web search tool call.');
    }

    expect(generatedToolCall.toolCallId).toHaveLength(53);
    expect(reportedToolCallId).toHaveLength(51);

    const chatResult = await openai.chat('gpt-4o-mini').doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Find the title of the official OpenAI API documentation.',
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: reportedToolCallId,
              toolName: 'web_search_preview',
              input: {},
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: reportedToolCallId,
              toolName: 'web_search_preview',
              output: {
                type: 'json',
                value: {
                  action: {
                    type: 'search',
                    query: 'official OpenAI API documentation page title',
                  },
                },
              },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Reply with only the documentation page title.',
            },
          ],
        },
      ],
    });

    expect(chatResult.content).toContainEqual({
      type: 'text',
      text: 'OpenAI API Documentation',
      providerMetadata: undefined,
    });

    const chatRequest = await server.calls[1].requestBodyJson;
    expect(chatRequest.messages[1].tool_calls[0].id).toBe(reportedToolCallId);
    expect(chatRequest.messages[2].tool_call_id).toBe(reportedToolCallId);
  });
});
