import assert from 'node:assert/strict';
import {
  generateText,
  InvalidPromptError,
  type ModelMessage,
} from '../../../../packages/ai/dist/index.mjs';
import { MockLanguageModelV2 } from '../../../../packages/ai/dist/test/index.mjs';

const responseValues = {
  finishReason: 'stop' as const,
  usage: {
    inputTokens: 3,
    outputTokens: 10,
    totalTokens: 13,
    reasoningTokens: 5,
    cachedInputTokens: undefined,
  },
  warnings: [],
};

function roundTripThroughMongoDefault<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) =>
      nestedValue === undefined ? null : nestedValue,
    ),
  );
}

function roundTripThroughMongoIgnoreUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function assertGenerateTextAccepts(messages: ModelMessage[]) {
  return generateText({
    model: new MockLanguageModelV2({
      doGenerate: {
        ...responseValues,
        content: [{ type: 'text', text: 'The persisted context is valid.' }],
      },
    }),
    messages,
  });
}

async function main() {
  const initialMessages: ModelMessage[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Which is bigger, 9.9 or 9.11?' }],
    },
  ];

  const initialResult = await generateText({
    model: new MockLanguageModelV2({
      provider: 'openrouter',
      doGenerate: {
        ...responseValues,
        content: [
          {
            type: 'reasoning',
            text: 'Compare the decimal values.',
            providerMetadata: {
              openrouter: {
                reasoning_details: [
                  {
                    type: 'reasoning.encrypted',
                    data: 'encrypted-reasoning-data',
                    format: 'google-gemini-v1',
                    index: 0,
                  },
                ],
              },
            },
          },
          { type: 'text', text: '9.9 is bigger than 9.11.' },
        ],
      },
    }),
    messages: initialMessages,
  });

  const context = [...initialMessages, ...initialResult.response.messages];
  const assistantContent = context[1].content;
  assert.ok(Array.isArray(assistantContent));

  const textPart = assistantContent.find(part => part.type === 'text');
  assert.equal(textPart?.providerOptions, undefined);

  // The SDK-produced ModelMessage[] can be used directly on the next turn.
  await assertGenerateTextAccepts(context);

  // MongoDB's documented default serialization maps undefined fields to null.
  const defaultPersistedContext =
    roundTripThroughMongoDefault<ModelMessage[]>(context);
  const defaultAssistantContent = defaultPersistedContext[1].content;
  assert.ok(Array.isArray(defaultAssistantContent));
  const defaultTextPart = defaultAssistantContent.find(
    part => part.type === 'text',
  );
  assert.equal(defaultTextPart?.providerOptions, null);

  let defaultSerializationError: unknown;
  try {
    await assertGenerateTextAccepts(defaultPersistedContext);
  } catch (error) {
    defaultSerializationError = error;
  }
  assert.ok(defaultSerializationError instanceof InvalidPromptError);

  // MongoDB's ignoreUndefined option omits the undefined text-part field.
  const correctedContext =
    roundTripThroughMongoIgnoreUndefined<ModelMessage[]>(context);
  const correctedAssistantContent = correctedContext[1].content;
  assert.ok(Array.isArray(correctedAssistantContent));
  const correctedTextPart = correctedAssistantContent.find(
    part => part.type === 'text',
  );
  assert.equal('providerOptions' in correctedTextPart!, false);

  const correctedReasoningPart = correctedAssistantContent.find(
    part => part.type === 'reasoning',
  );
  assert.deepEqual(correctedReasoningPart?.providerOptions, {
    openrouter: {
      reasoning_details: [
        {
          type: 'reasoning.encrypted',
          data: 'encrypted-reasoning-data',
          format: 'google-gemini-v1',
          index: 0,
        },
      ],
    },
  });
  await assertGenerateTextAccepts(correctedContext);

  console.log(
    JSON.stringify(
      {
        directRoundTrip: 'accepted',
        mongoDefault: {
          textProviderOptions: defaultTextPart?.providerOptions,
          validationError:
            defaultSerializationError instanceof Error
              ? defaultSerializationError.name
              : String(defaultSerializationError),
        },
        mongoIgnoreUndefined: {
          textProviderOptionsOmitted: !(
            'providerOptions' in correctedTextPart!
          ),
          reasoningMetadataPreserved: true,
          roundTrip: 'accepted',
        },
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
