import { generateText, streamText, wrapLanguageModel } from 'ai';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  SharedV3ProviderOptions,
} from '@ai-sdk/provider';

function hasIncludeThoughts(providerOptions?: SharedV3ProviderOptions) {
  return (
    (
      providerOptions?.google as {
        thinkingConfig?: { includeThoughts?: boolean };
      }
    )?.thinkingConfig?.includeThoughts === true
  );
}

function streamFromArray<T>(parts: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

function createUsage() {
  return {
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
}

function createReasoningConditionalModel(): LanguageModelV3 & {
  doGenerateCalls: LanguageModelV3CallOptions[];
  doStreamCalls: LanguageModelV3CallOptions[];
} {
  const doGenerateCalls: LanguageModelV3CallOptions[] = [];
  const doStreamCalls: LanguageModelV3CallOptions[] = [];

  return {
    specificationVersion: 'v3',
    provider: 'reproduction-provider',
    modelId: 'issue-15704-reasoning-conditional-model',
    supportedUrls: {},
    doGenerate: async options => {
      doGenerateCalls.push(options);

      return {
        content: [
          ...(hasIncludeThoughts(options.providerOptions)
            ? [{ type: 'reasoning' as const, text: 'generated reasoning' }]
            : []),
          { type: 'text' as const, text: 'generated answer' },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: createUsage(),
        warnings: [],
      } satisfies LanguageModelV3GenerateResult;
    },
    doStream: async options => {
      doStreamCalls.push(options);

      const streamParts: LanguageModelV3StreamPart[] = [
        {
          type: 'stream-start',
          warnings: [],
        },
      ];

      if (hasIncludeThoughts(options.providerOptions)) {
        streamParts.push(
          { type: 'reasoning-start', id: 'reasoning-1' },
          {
            type: 'reasoning-delta',
            id: 'reasoning-1',
            delta: 'streamed reasoning',
          },
          { type: 'reasoning-end', id: 'reasoning-1' },
        );
      }

      streamParts.push(
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'streamed answer' },
        { type: 'text-end', id: 'text-1' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: createUsage(),
        },
      );

      return {
        stream: streamFromArray(streamParts),
      } satisfies LanguageModelV3StreamResult;
    },
    doGenerateCalls,
    doStreamCalls,
  };
}

function assertTrue(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const underlyingModel = createReasoningConditionalModel();

  const model = wrapLanguageModel({
    model: underlyingModel,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => {
        (params.providerOptions ??= {}).google = {
          thinkingConfig: { includeThoughts: true },
        };
        return params;
      },
    },
  });

  const generateResult = await generateText({
    model,
    prompt: 'hi',
  });

  const streamResult = streamText({
    model,
    prompt: 'hi',
  });

  for await (const _ of streamResult.fullStream) {
    // Consume the stream so result promises settle.
  }

  const streamReasoning = await streamResult.reasoning;

  const providerOptionsReachedGenerate = hasIncludeThoughts(
    underlyingModel.doGenerateCalls[0]?.providerOptions,
  );
  const providerOptionsReachedStream = hasIncludeThoughts(
    underlyingModel.doStreamCalls[0]?.providerOptions,
  );
  const generateHasReasoning = generateResult.reasoning.length > 0;
  const streamHasReasoning = streamReasoning.length > 0;

  console.log(
    JSON.stringify(
      {
        providerOptionsReached: {
          generateText: providerOptionsReachedGenerate,
          streamText: providerOptionsReachedStream,
        },
        reasoning: {
          generateText: generateHasReasoning,
          streamText: streamHasReasoning,
        },
      },
      null,
      2,
    ),
  );

  assertTrue(
    providerOptionsReachedGenerate,
    'generateText did not pass transformed providerOptions to the model',
  );
  assertTrue(
    providerOptionsReachedStream,
    'streamText did not pass transformed providerOptions to the model',
  );
  assertTrue(
    generateHasReasoning,
    'generateText did not surface reasoning when transformed providerOptions reached the model',
  );
  assertTrue(
    streamHasReasoning,
    'streamText did not surface reasoning when transformed providerOptions reached the model',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
