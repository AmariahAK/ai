import assert from 'node:assert/strict';
import { generateText, InvalidPromptError, type ModelMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 2,
    text: 1,
    reasoning: 1,
  },
};

const responseModel = new MockLanguageModelV3({
  provider: 'openrouter',
  modelId: 'google/gemini-3-flash-preview',
  doGenerate: {
    content: [
      {
        type: 'reasoning',
        text: '[REDACTED]',
        providerMetadata: {
          openrouter: {
            reasoning_details: [
              {
                type: 'reasoning.encrypted',
                data: 'encrypted-reasoning',
                format: 'google-gemini-v1',
                index: 0,
              },
            ],
          },
        },
      },
      { type: 'text', text: '9.9 is bigger than 9.11.' },
    ],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage,
    warnings: [],
  },
});

const continuationModel = new MockLanguageModelV3({
  provider: 'openrouter',
  modelId: 'google/gemini-3-flash-preview',
  doGenerate: {
    content: [{ type: 'text', text: 'continued' }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage,
    warnings: [],
  },
});

/**
 * Reproduces the MongoDB Node.js driver's documented handling of undefined
 * fields. By default they are persisted as null; with ignoreUndefined enabled
 * they are omitted.
 */
function simulateMongoRoundTrip<T>(
  value: T,
  { ignoreUndefined }: { ignoreUndefined: boolean },
): T {
  function serialize(input: unknown): unknown {
    if (Array.isArray(input)) {
      return input.map(item => serialize(item));
    }

    if (input != null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input).flatMap(([key, item]) => {
          if (item === undefined) {
            return ignoreUndefined ? [] : [[key, null]];
          }

          return [[key, serialize(item)]];
        }),
      );
    }

    return input;
  }

  return serialize(value) as T;
}

async function main() {
  const userMessage: ModelMessage = {
    role: 'user',
    content: [{ type: 'text', text: 'Which is bigger, 9.9 or 9.11?' }],
  };

  const firstTurn = await generateText({
    model: responseModel,
    messages: [userMessage],
  });

  const context: ModelMessage[] = [userMessage, ...firstTurn.response.messages];
  const assistantMessage = context[1];

  assert.equal(assistantMessage.role, 'assistant');
  assert.ok(Array.isArray(assistantMessage.content));

  const reasoningPart = assistantMessage.content[0];
  const textPart = assistantMessage.content[1];

  assert.equal(reasoningPart.type, 'reasoning');
  assert.equal(textPart.type, 'text');

  if (reasoningPart.type !== 'reasoning' || textPart.type !== 'text') {
    throw new Error('Expected reasoning and text response parts.');
  }

  assert.deepEqual(reasoningPart.providerOptions, {
    openrouter: {
      reasoning_details: [
        {
          type: 'reasoning.encrypted',
          data: 'encrypted-reasoning',
          format: 'google-gemini-v1',
          index: 0,
        },
      ],
    },
  });
  assert.ok(Object.hasOwn(textPart, 'providerOptions'));
  assert.equal(textPart.providerOptions, undefined);

  const defaultMongoContext = simulateMongoRoundTrip(context, {
    ignoreUndefined: false,
  });
  const defaultMongoAssistant = defaultMongoContext[1];

  assert.equal(defaultMongoAssistant.role, 'assistant');
  assert.ok(Array.isArray(defaultMongoAssistant.content));
  assert.equal(
    (
      defaultMongoAssistant.content[1] as {
        providerOptions?: unknown;
      }
    ).providerOptions,
    null,
  );

  await assert.rejects(
    generateText({
      model: continuationModel,
      messages: defaultMongoContext,
    }),
    error =>
      InvalidPromptError.isInstance(error) &&
      error.message.includes(
        'The messages do not match the ModelMessage[] schema.',
      ),
  );

  const ignoreUndefinedContext = simulateMongoRoundTrip(context, {
    ignoreUndefined: true,
  });
  const continued = await generateText({
    model: continuationModel,
    messages: ignoreUndefinedContext,
  });

  assert.equal(continued.text, 'continued');

  const forwardedAssistant =
    continuationModel.doGenerateCalls.at(-1)?.prompt[1];

  assert.equal(forwardedAssistant?.role, 'assistant');
  assert.deepEqual(forwardedAssistant?.providerOptions, undefined);
  assert.deepEqual(
    forwardedAssistant?.content[0]?.providerOptions,
    reasoningPart.providerOptions,
  );

  console.log(
    JSON.stringify(
      {
        defaultMongoPersistence:
          'providerOptions: undefined became null and ModelMessage validation failed',
        ignoreUndefinedPersistence:
          'undefined fields were omitted, validation passed, and reasoning metadata was preserved',
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
