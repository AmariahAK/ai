#!/usr/bin/env node

/**
 * Reproduction for vercel/ai#13335.
 *
 * The reported bug is that an Anthropic compaction block with empty content can
 * be persisted as an assistant text part with Anthropic provider metadata. On
 * the next request, @ai-sdk/anthropic turns that text part back into:
 *
 *   { "type": "compaction", "content": "" }
 *
 * Anthropic rejects that request with
 * "compaction.content: content cannot be empty".
 *
 * Run from the repository root after packages have been built:
 *
 *   node packages/anthropic/reproductions/reproduce-issue-13335-empty-compaction.mjs
 *
 * If ANTHROPIC_API_KEY is set, the script also performs a live Anthropic call
 * with the SDK-generated message shape and verifies the provider rejection.
 */

import assert from 'node:assert/strict';
import { convertToModelMessages } from '../../../packages/ai/dist/index.js';
import { createAnthropic } from '../dist/index.js';

const MODEL_ID = process.env.ANTHROPIC_MODEL_ID ?? 'claude-sonnet-4-5';

const uiMessages = [
  {
    role: 'user',
    parts: [{ type: 'text', text: 'hi' }],
  },
  {
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: '',
        state: 'done',
        providerMetadata: {
          anthropic: { type: 'compaction' },
        },
      },
    ],
  },
  {
    role: 'user',
    parts: [{ type: 'text', text: 'next turn' }],
  },
];

const modelMessages = await convertToModelMessages(uiMessages);

let capturedRequestBody;
const captureProvider = createAnthropic({
  apiKey: 'test-api-key',
  fetch: async (_url, init) => {
    capturedRequestBody = JSON.parse(init.body);

    return new Response(
      JSON.stringify({
        id: 'msg_capture',
        type: 'message',
        role: 'assistant',
        model: MODEL_ID,
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
});

await captureProvider(MODEL_ID).doGenerate({
  prompt: modelMessages,
  maxOutputTokens: 1,
  providerOptions: {
    anthropic: {
      contextManagement: {
        edits: [
          {
            type: 'compact_20260112',
            trigger: { type: 'input_tokens', value: 150_000 },
            instructions: 'Summarize.',
          },
        ],
      },
    },
  },
});

const replayedCompaction = capturedRequestBody.messages[1].content[0];

console.log('SDK-generated replay content block:');
console.log(JSON.stringify(replayedCompaction, null, 2));

assert.deepEqual(
  replayedCompaction,
  { type: 'compaction', content: '' },
  'Expected the current SDK to replay the persisted empty compaction block.',
);

let liveRejectionMessage;

if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
  try {
    await createAnthropic({})(MODEL_ID).doGenerate({
      prompt: modelMessages,
      maxOutputTokens: 1,
      providerOptions: {
        anthropic: {
          contextManagement: {
            edits: [
              {
                type: 'compact_20260112',
                trigger: { type: 'input_tokens', value: 150_000 },
                instructions: 'Summarize.',
              },
            ],
          },
        },
      },
    });

    throw new Error(
      'Expected Anthropic to reject an empty compaction block, but the live request succeeded.',
    );
  } catch (error) {
    liveRejectionMessage =
      error instanceof Error ? error.message : String(error);

    assert.match(
      liveRejectionMessage,
      /compaction\.content: content can(?:not|'t) be empty/,
      `Unexpected live Anthropic error: ${liveRejectionMessage}`,
    );

    console.log('Live Anthropic rejection:');
    console.log(liveRejectionMessage);
  }
} else {
  console.log(
    'ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN is not set; skipped the optional live rejection check.',
  );
}

throw new Error(
  `Reproduced vercel/ai#13335: @ai-sdk/anthropic replays an empty compaction block (${JSON.stringify(
    replayedCompaction,
  )})${
    liveRejectionMessage
      ? ` and Anthropic rejects it with "${liveRejectionMessage}".`
      : '.'
  }`,
);
