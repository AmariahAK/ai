#!/usr/bin/env node

/**
 * Reproduction for vercel/ai#13430.
 *
 * Run from the repository root after building packages:
 *
 *   pnpm build:packages
 *   node reproductions/issue-13430-prune-reasoning-only.mjs
 *
 * The fixture models the post-convertToModelMessages shape described in the
 * issue: an old assistant message from a thinking model contains only a
 * reasoning part plus a tool-call for `checkSandboxErrors`. pruneMessages
 * removes the old tool call/result but currently leaves the reasoning part,
 * producing an assistant message with no non-reasoning content.
 */

import assert from 'node:assert/strict';
import { pruneMessages } from '../packages/ai/dist/index.js';

const messages = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Check the sandbox for errors.' }],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'reasoning',
        text: 'Let me check for errors before answering.',
        state: 'done',
      },
      {
        type: 'tool-call',
        toolCallId: 'call-check-errors-1',
        toolName: 'checkSandboxErrors',
        input: {},
      },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call-check-errors-1',
        toolName: 'checkSandboxErrors',
        output: { type: 'text', value: 'No errors found.' },
      },
    ],
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'No sandbox errors were found.' }],
  },
  {
    role: 'user',
    content: [{ type: 'text', text: 'Continue.' }],
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'Continuing.' }],
  },
  {
    role: 'user',
    content: [{ type: 'text', text: 'Anything else?' }],
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'Nothing else.' }],
  },
];

const pruned = pruneMessages({
  messages,
  toolCalls: [
    { type: 'before-last-5-messages', tools: ['checkSandboxErrors'] },
  ],
  emptyMessages: 'remove',
});

console.dir(pruned, { depth: null });

const reasoningOnlyAssistantMessages = pruned.filter(
  message =>
    message.role === 'assistant' &&
    Array.isArray(message.content) &&
    message.content.length > 0 &&
    message.content.every(part => part.type === 'reasoning'),
);

assert.equal(
  reasoningOnlyAssistantMessages.length,
  0,
  `pruneMessages left ${reasoningOnlyAssistantMessages.length} assistant message(s) with only reasoning parts`,
);

console.log('PASS: pruneMessages removed old tool calls without orphaning reasoning-only assistant messages.');
