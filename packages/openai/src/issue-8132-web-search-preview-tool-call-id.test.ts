import fs from 'node:fs';

import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { describe, expect, it } from 'vitest';
import { createOpenAI } from './openai-provider';

describe('issue #8132', () => {
  const server = createTestServer({
    'https://api.openai.com/v1/responses': {},
    'https://api.openai.com/v1/chat/completions': {},
  });

  it('round-trips a web search preview ID longer than 40 characters', async () => {
    server.urls['https://api.openai.com/v1/responses'].response = {
      type: 'json-value',
      body: JSON.parse(
        fs.readFileSync(
          'src/responses/__fixtures__/issue-8132-web-search-preview.json',
          'utf8',
        ),
      ),
    };
    server.urls['https://api.openai.com/v1/chat/completions'].response = {
      type: 'json-value',
      body: JSON.parse(
        fs.readFileSync(
          'src/chat/__fixtures__/issue-8132-long-tool-call-id.json',
          'utf8',
        ),
      ),
    };

    const openai = createOpenAI({ apiKey: 'test-api-key' });
    const responsesResult = await openai.responses('gpt-4o-mini').doGenerate({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Search the web.' }],
        },
      ],
      tools: [
        {
          type: 'provider',
          id: 'openai.web_search_preview',
          name: 'web_search_preview',
          args: {},
        },
      ],
    });

    const reportedToolCallId =
      'ws_689e2d4880a0819d98acca37694989b00b15d90494fc6b87';
    const assistantContent = responsesResult.content
      .filter(part => part.type === 'text' || part.type === 'tool-call')
      .map(part =>
        part.type === 'tool-call'
          ? { ...part, toolCallId: reportedToolCallId }
          : part,
      );
    const toolContent = responsesResult.content
      .filter(part => part.type === 'tool-result')
      .map(part => ({
        type: 'tool-result' as const,
        toolCallId: reportedToolCallId,
        toolName: part.toolName,
        output: { type: 'json' as const, value: part.result },
      }));
    const prompt: LanguageModelV4Prompt = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Search the web.' }],
      },
      { role: 'assistant', content: assistantContent },
      { role: 'tool', content: toolContent },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Reply with the title.' }],
      },
    ];

    const chatResult = await openai.chat('gpt-4o-mini').doGenerate({ prompt });

    expect(reportedToolCallId).toHaveLength(51);
    expect(
      (await server.calls[1].requestBodyJson).messages[1].tool_calls[0].id,
    ).toBe(reportedToolCallId);
    expect(chatResult.content).toEqual([
      { type: 'text', text: 'API Platform | OpenAI' },
    ]);
  });
});
