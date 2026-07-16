import { readFile } from 'node:fs/promises';
import { createToolNameMapping } from '@ai-sdk/provider-utils';
import { describe, it } from 'vitest';
import { convertToAnthropicPrompt } from './convert-to-anthropic-prompt';

const serverToolCallId = 'srvtoolu_01FvCG2mjosttzrL4Lnb5mHy';

describe('issue #17366', () => {
  it('does not serialize a synthetic error for a provider-executed call as a client tool_result', async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          './__fixtures__/anthropic-issue-17366-orphan-tool-result.1.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );

    const result = await convertToAnthropicPrompt({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: serverToolCallId,
              toolName: 'web_search',
              input: {},
              providerExecuted: true,
            },
            {
              type: 'tool-result',
              toolCallId: serverToolCallId,
              toolName: 'web_search',
              output: {
                type: 'error-json',
                value: {
                  type: 'web_search_tool_result_error',
                  errorCode: 'invalid_tool_input',
                },
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: serverToolCallId,
              toolName: 'web_search',
              output: {
                type: 'error-text',
                value: 'SDK local input validation failed',
              },
            },
          ],
        },
      ],
      sendReasoning: false,
      warnings: [],
      toolNameMapping: createToolNameMapping({
        tools: [],
        providerToolNames: {},
      }),
    });

    const orphanedToolResult = result.prompt.messages
      .filter(message => message.role === 'user')
      .flatMap(message => message.content)
      .find(
        part =>
          part.type === 'tool_result' && part.tool_use_id === serverToolCallId,
      );

    if (orphanedToolResult != null) {
      throw new Error(
        `Reproduced issue #17366: ${fixture.response.body.error.message}`,
      );
    }
  });
});
