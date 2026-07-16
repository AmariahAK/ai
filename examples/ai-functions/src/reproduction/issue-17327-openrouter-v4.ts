import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import assert from 'node:assert/strict';
import { streamText as streamTextCurrent } from 'ai';
import { streamText as streamTextReported } from 'ai-7-0-22';

const modelId = 'minimax/minimax-m2.7';
const expectedText = 'compatibility-ok';

const openrouter = createOpenRouter({
  apiKey: 'test-api-key',
  fetch: async (_input, init) => {
    const body = JSON.parse(String(init?.body));

    assert.equal(body.model, modelId);
    assert.equal(body.stream, true);

    const chunks = [
      {
        id: 'chatcmpl-issue-17327',
        model: modelId,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: expectedText },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-issue-17327',
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      },
    ];

    return new Response(
      `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
      {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      },
    );
  },
});

async function runReportedVersion(): Promise<void> {
  const model = openrouter(modelId);

  assert.equal(model.specificationVersion, 'v4');

  const result = streamTextReported({
    model,
    prompt: 'Reply with compatibility-ok.',
  });
  const text = await result.text;

  assert.equal(text, expectedText);
  console.log(`ai@7.0.22 accepted OpenRouter LanguageModelV4: ${text}`);
}

async function runCurrentVersion(): Promise<void> {
  const model = openrouter(modelId);

  assert.equal(model.specificationVersion, 'v4');

  const result = streamTextCurrent({
    model,
    prompt: 'Reply with compatibility-ok.',
  });
  const text = await result.text;

  assert.equal(text, expectedText);
  console.log(`ai@7.0.29 accepted OpenRouter LanguageModelV4: ${text}`);
}

async function main(): Promise<void> {
  await runReportedVersion();
  await runCurrentVersion();
  console.log('Issue #17327 could not be reproduced.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
