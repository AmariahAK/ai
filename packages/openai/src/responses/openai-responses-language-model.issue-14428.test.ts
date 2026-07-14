import {
  convertReadableStreamToArray,
  mockId,
} from '@ai-sdk/provider-utils/test';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OpenAIResponsesLanguageModel } from './openai-responses-language-model';

describe('OpenAIResponsesLanguageModel issue #14428', () => {
  const server = createTestServer({
    'https://api.openai.com/v1/responses': {},
  });

  it('should continue after a denied client tool approval', async () => {
    const chunks = fs
      .readFileSync(
        'src/responses/__fixtures__/openai-issue-14428-denied-tool-approval.chunks.txt',
        'utf8',
      )
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => `data: ${line}\n\n`);
    chunks.push('data: [DONE]\n\n');

    server.urls['https://api.openai.com/v1/responses'].response = {
      type: 'stream-chunks',
      chunks,
    };

    const model = new OpenAIResponsesLanguageModel('gpt-4o', {
      provider: 'openai',
      url: ({ path }) => `https://api.openai.com/v1${path}`,
      headers: () => ({ Authorization: 'Bearer APIKEY' }),
      generateId: mockId(),
    });

    const { stream } = await model.doStream({
      prompt: [
        {
          role: 'system',
          content:
            'The user denied the sendEmail tool call. Do not call tools again. Briefly acknowledge the denial.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'send an email to test@test.com saying hello',
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_search_14428',
              toolName: 'searchMemory',
              input: { query: 'contact test@test.com' },
            },
            {
              type: 'tool-call',
              toolCallId: 'call_send_14428',
              toolName: 'sendEmail',
              input: {
                to: 'test@test.com',
                subject: 'Hello',
                body: 'Hello',
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_search_14428',
              toolName: 'searchMemory',
              output: {
                type: 'json',
                value: {
                  resultCount: 0,
                  query: 'contact test@test.com',
                },
              },
            },
            {
              type: 'tool-result',
              toolCallId: 'call_send_14428',
              toolName: 'sendEmail',
              output: {
                type: 'execution-denied',
                reason: 'User denied',
              },
            },
          ],
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'searchMemory',
          description: 'Search memory',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
        },
        {
          type: 'function',
          name: 'sendEmail',
          description: 'Send an email',
          inputSchema: {
            type: 'object',
            properties: {
              to: { type: 'string' },
              subject: { type: 'string' },
              body: { type: 'string' },
            },
            required: ['to', 'subject', 'body'],
            additionalProperties: false,
          },
        },
      ],
      includeRawChunks: false,
    });

    const events = await convertReadableStreamToArray(stream);

    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(
      events
        .filter(event => event.type === 'text-delta')
        .map(event => event.delta)
        .join(''),
    ).not.toBe('');
    expect(await server.calls[0].requestBodyJson).toMatchObject({
      input: expect.arrayContaining([
        {
          type: 'function_call_output',
          call_id: 'call_send_14428',
          output: 'User denied',
        },
      ]),
    });
  });
});
