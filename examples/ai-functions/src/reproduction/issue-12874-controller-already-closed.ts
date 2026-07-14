import type {
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { streamText, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod/v4';

const usage: LanguageModelV4Usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 1,
    text: undefined,
    reasoning: undefined,
  },
};

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

function isControllerAlreadyClosed(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('Controller is already closed')
  );
}

async function runScenario({
  name,
  emitFinishBeforeError,
}: {
  name: string;
  emitFinishBeforeError: boolean;
}) {
  const processErrors: unknown[] = [];
  const streamErrors: unknown[] = [];
  const startedTools: string[] = [];
  const completedTools: string[] = [];

  const onUnhandledRejection = (error: unknown) => {
    processErrors.push(error);
  };
  const onUncaughtException = (error: unknown) => {
    processErrors.push(error);
  };

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  try {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({
              type: 'response-metadata',
              id: 'resp-1',
              modelId: 'mock-model',
              timestamp: new Date(0),
            });
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'slowToolA',
              input: '{"q":"a"}',
            });
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'call-2',
              toolName: 'slowToolB',
              input: '{"q":"b"}',
            });

            if (emitFinishBeforeError) {
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
                usage,
              });
            }

            setTimeout(() => {
              controller.error(
                new Error(`${name}: simulated model stream error`),
              );
            }, 50);
          },
        }),
      }),
    });

    const createSlowTool = (toolName: string, durationMs: number) =>
      tool({
        description: toolName,
        inputSchema: z.object({ q: z.string() }),
        execute: async () => {
          startedTools.push(toolName);
          await delay(durationMs);
          completedTools.push(toolName);
          return { ok: true };
        },
      });

    const result = streamText({
      model,
      prompt: 'test',
      tools: {
        slowToolA: createSlowTool('slowToolA', 200),
        slowToolB: createSlowTool('slowToolB', 300),
      },
      onError: () => {},
    });

    try {
      for await (const _ of result.fullStream) {
        // Consume the complete stream to exercise stream cancellation/error handling.
      }
    } catch (error) {
      streamErrors.push(error);
    }

    await delay(500);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    process.off('uncaughtException', onUncaughtException);
  }

  return {
    name,
    emitFinishBeforeError,
    startedTools,
    completedTools,
    streamErrors: streamErrors.map(error =>
      error instanceof Error ? error.message : String(error),
    ),
    processErrors: processErrors.map(error =>
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: typeof error, message: String(error) },
    ),
    controllerAlreadyClosed: processErrors.some(isControllerAlreadyClosed),
  };
}

async function main() {
  const reportedShape = await runScenario({
    name: 'error-before-finish',
    emitFinishBeforeError: false,
  });
  const executionNarrowingShape = await runScenario({
    name: 'error-after-finish',
    emitFinishBeforeError: true,
  });

  const observations = {
    aiVersion: '7.0.26',
    reportedShape,
    executionNarrowingShape,
  };

  console.log(JSON.stringify(observations, null, 2));

  if (
    reportedShape.controllerAlreadyClosed ||
    executionNarrowingShape.controllerAlreadyClosed
  ) {
    throw new Error(
      'Issue #12874 reproduced: an unhandled "Controller is already closed" error occurred.',
    );
  }

  if (reportedShape.streamErrors.length === 0) {
    throw new Error('The reported-shape model stream error was not observed.');
  }

  if (reportedShape.startedTools.length !== 0) {
    throw new Error(
      'The reported-shape tools unexpectedly started before model-call completion.',
    );
  }

  if (executionNarrowingShape.startedTools.length !== 2) {
    throw new Error(
      'The narrowing scenario did not start both tools before handling the late model stream error.',
    );
  }

  console.log(
    'Could not reproduce issue #12874: both stream errors were handled without a process-level controller crash.',
  );
}

main();
