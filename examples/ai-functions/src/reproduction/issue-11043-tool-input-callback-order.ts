import {
  generateText,
  jsonSchema,
  tool,
} from '../../../../packages/ai/dist/index.mjs';

async function main() {
  const callbackSequence: string[] = [];
  let inputStarted = false;
  let inputAvailableBeforeStart = false;

  await generateText({
    model: {
      specificationVersion: 'v2',
      provider: 'reproduction',
      modelId: 'issue-11043',
      supportedUrls: {},
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call',
            toolCallType: 'function',
            toolCallId: 'call-1',
            toolName: 'test-tool',
            input: '{"value":"available-in-one-go"}',
          },
        ],
        finishReason: 'tool-calls',
        usage: {
          inputTokens: 3,
          outputTokens: 10,
          totalTokens: 13,
        },
        warnings: [],
      }),
      doStream: async () => {
        throw new Error('Streaming is not used by this reproduction.');
      },
    },
    tools: {
      'test-tool': tool({
        inputSchema: jsonSchema<{ value: string }>({
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
          additionalProperties: false,
        }),
        onInputStart: () => {
          inputStarted = true;
          callbackSequence.push('onInputStart');
        },
        onInputAvailable: () => {
          if (!inputStarted) {
            inputAvailableBeforeStart = true;
          }
          callbackSequence.push('onInputAvailable');
        },
      }),
    },
    toolChoice: 'required',
    prompt: 'Call test-tool.',
  });

  if (inputAvailableBeforeStart) {
    console.error(
      'ISSUE #11043 REPRODUCED: onInputAvailable was called without a preceding onInputStart',
    );
    console.error(
      `Observed callback sequence: ${callbackSequence.join(' -> ')}`,
    );
    process.exitCode = 1;
    return;
  }

  const expectedSequence = ['onInputStart', 'onInputAvailable'];
  if (callbackSequence.join(',') !== expectedSequence.join(',')) {
    console.error(
      `Unexpected callback sequence: ${callbackSequence.join(' -> ') || '(none)'}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Expected callback sequence observed: ${callbackSequence.join(' -> ')}`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
