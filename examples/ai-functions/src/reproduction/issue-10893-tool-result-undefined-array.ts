import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { streamText, tool, type ModelMessage } from 'ai';
import { z } from 'zod';

const usage: LanguageModelV4Usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: undefined,
  },
};

function streamFrom(parts: LanguageModelV4StreamPart[]) {
  return new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

class ToolCallingMockModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'mock-provider';
  readonly modelId = 'mock-model-id';
  readonly supportedUrls = {};

  calls: LanguageModelV4CallOptions[] = [];

  async doGenerate(): Promise<LanguageModelV4GenerateResult> {
    throw new Error('This reproduction only uses streamText.');
  }

  async doStream(options: LanguageModelV4CallOptions) {
    this.calls.push(options);

    return {
      stream: streamFrom([
        {
          type: 'tool-call',
          toolCallId: `call-${this.calls.length}`,
          toolName: 'listTasks',
          input: '{}',
        },
        {
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
          usage,
        },
      ]),
    };
  }
}

const listTasks = tool({
  description: 'List tasks',
  inputSchema: z.object({
    limit: z.number().optional(),
  }),
  execute: async ({ limit = 20 }) => {
    void limit;

    return [
      {
        id: '1',
        state: 'completed',
        startedAt: '2025-10-26T17:59:40.065Z',
        completedAt: '2025-10-26T18:00:31.713Z',
      },
      {
        id: '2',
        state: 'archived',
        startedAt: undefined,
        completedAt: undefined,
      },
    ];
  },
});

function serializeMessages(messages: ModelMessage[]) {
  return JSON.parse(JSON.stringify(messages)) as ModelMessage[];
}

async function main() {
  const model = new ToolCallingMockModel();

  const firstResult = streamText({
    model,
    messages: [{ role: 'user', content: 'List all the tasks' }],
    tools: { listTasks },
  });

  for await (const _chunk of firstResult.textStream) {
    // Consume the stream so the tool call is executed and response messages resolve.
  }

  const firstResponse = await firstResult.response;
  const serializedToolMessages = serializeMessages(firstResponse.messages);

  console.log(
    'Serialized response messages with undefined properties stripped:',
  );
  console.log(JSON.stringify(serializedToolMessages, null, 2));

  try {
    const secondResult = streamText({
      model,
      messages: [
        { role: 'user', content: 'List all the tasks' },
        ...serializedToolMessages,
      ],
      tools: { listTasks },
    });

    for await (const _chunk of secondResult.textStream) {
      // The reported bug throws before or during this consumption.
    }
  } catch (error) {
    console.error('Issue #10893 reproduced: the second streamText call threw.');
    console.error(error);
    process.exitCode = 1;
    return;
  }

  if (model.calls.length !== 2) {
    throw new Error(
      `Expected the second streamText call to reach the model, but got ${model.calls.length} call(s).`,
    );
  }

  console.log(
    'Could not reproduce issue #10893: the second streamText call accepted the serialized tool-result messages.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
