import {
  anthropic,
  type AnthropicLanguageModelOptions,
} from '@ai-sdk/anthropic';
import { streamText, type ModelMessage } from 'ai';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

type AnthropicUsage = {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

const modelId = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

async function runRequest(messages: ModelMessage[]) {
  const result = streamText({
    model: anthropic(modelId),
    messages,
    maxOutputTokens: 2,
    include: {
      rawChunks: true,
      requestBody: true,
    },
  });

  const rawChunks: unknown[] = [];

  for await (const part of result.fullStream) {
    if (part.type === 'raw') {
      rawChunks.push(part.rawValue);
    }
  }

  const finalStep = await result.finalStep;
  const usage = finalStep.providerMetadata?.anthropic?.usage as
    | AnthropicUsage
    | undefined;

  return {
    requestBody: finalStep.request.body,
    rawChunks,
    usage,
  };
}

async function main() {
  const runId = randomUUID();
  const longText = Array.from(
    { length: 400 },
    (_, index) =>
      `Cache reproduction ${runId}, line ${index}: message-level provider options must apply to structured text content.`,
  ).join('\n');

  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: longText }],
      providerOptions: {
        anthropic: {
          cacheControl: {
            type: 'ephemeral',
          },
        } satisfies AnthropicLanguageModelOptions,
      },
    },
  ];

  const first = await runRequest(messages);
  const second = await runRequest(messages);

  console.log(
    JSON.stringify(
      {
        model: modelId,
        first,
        second,
      },
      null,
      2,
    ),
  );

  const requestMessages = (
    first.requestBody as {
      messages?: Array<{
        content?: Array<{ cache_control?: { type?: string } }>;
      }>;
    }
  ).messages;

  assert.equal(
    requestMessages?.[0]?.content?.at(-1)?.cache_control?.type,
    'ephemeral',
    'Expected message-level providerOptions to add cache_control to the structured content block.',
  );
  assert.ok(
    (first.usage?.cache_creation_input_tokens ?? 0) > 0,
    'Expected the first request to create an Anthropic prompt cache entry.',
  );
  assert.ok(
    (second.usage?.cache_read_input_tokens ?? 0) > 0,
    'Expected the second request to read the Anthropic prompt from cache.',
  );
}

main();
