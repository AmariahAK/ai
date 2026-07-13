import type { LanguageModelV3Prompt } from '@ai-sdk/provider';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BedrockChatLanguageModel } from './bedrock-chat-language-model';

type Issue16662Fixture = {
  capturedRuns: Array<
    Array<{
      requestBody: string | null;
      responseBody: string;
      status: number;
    }>
  >;
};

const fixture = JSON.parse(
  fs.readFileSync('src/__fixtures__/issue-16662-live.json', 'utf8'),
) as Issue16662Fixture;

describe('issue #16662 live fixture', () => {
  it('returns the post-tool json tool call as structured-output text', async () => {
    const recordedCall = fixture.capturedRuns[0][1];
    let requestBody: any;

    const model = new BedrockChatLanguageModel('us.anthropic.claude-opus-4-8', {
      baseUrl: () => 'https://bedrock-runtime.us-east-1.amazonaws.com',
      headers: {},
      fetch: async (_input, init) => {
        requestBody = JSON.parse(init?.body as string);
        return new Response(recordedCall.responseBody, {
          status: recordedCall.status,
          headers: { 'content-type': 'application/json' },
        });
      },
      generateId: () => 'test-id',
    });

    const prompt: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Use both lookup tools and return structured output.',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'account-call',
            toolName: 'lookupAccount',
            input: { accountId: 'acct-16662' },
          },
          {
            type: 'tool-call',
            toolCallId: 'policy-call',
            toolName: 'lookupPolicy',
            input: { policyId: 'policy-16662' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'account-call',
            toolName: 'lookupAccount',
            output: {
              type: 'text',
              value: '{"accountTier":"gold"}',
            },
          },
          {
            type: 'tool-result',
            toolCallId: 'policy-call',
            toolName: 'lookupPolicy',
            output: {
              type: 'text',
              value: '{"policyLimit":100}',
            },
          },
        ],
      },
    ];

    const result = await model.doGenerate({
      prompt,
      responseFormat: {
        type: 'json',
        schema: {
          type: 'object',
          properties: {
            decision: { type: 'string', enum: ['approve', 'deny'] },
            accountTier: { type: 'string' },
            policyLimit: { type: 'number' },
          },
          required: ['decision', 'accountTier', 'policyLimit'],
          additionalProperties: false,
        },
      },
      tools: [
        {
          type: 'function',
          name: 'lookupAccount',
          description: 'Look up the account tier for an account ID.',
          inputSchema: {
            type: 'object',
            properties: { accountId: { type: 'string' } },
            required: ['accountId'],
            additionalProperties: false,
          },
          strict: true,
        },
        {
          type: 'function',
          name: 'lookupPolicy',
          description: 'Look up the numeric limit for a policy ID.',
          inputSchema: {
            type: 'object',
            properties: { policyId: { type: 'string' } },
            required: ['policyId'],
            additionalProperties: false,
          },
          strict: true,
        },
      ],
    });

    expect(requestBody.toolConfig.toolChoice).toEqual({ any: {} });
    expect(
      requestBody.toolConfig.tools.map(
        (tool: { toolSpec: { name: string } }) => tool.toolSpec.name,
      ),
    ).toEqual(['lookupAccount', 'lookupPolicy', 'json']);
    expect(
      requestBody.toolConfig.tools.every(
        (tool: { toolSpec: { strict?: boolean } }) =>
          tool.toolSpec.strict == null,
      ),
    ).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: '{"decision":"approve","accountTier":"gold","policyLimit":100}',
      },
    ]);
    expect(result.finishReason).toEqual({
      unified: 'stop',
      raw: 'tool_use',
    });
    expect(result.providerMetadata?.bedrock?.isJsonResponseFromTool).toBe(true);
  });
});
