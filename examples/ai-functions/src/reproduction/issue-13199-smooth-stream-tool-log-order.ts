import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { smoothStream, tool, ToolLoopAgent } from 'ai';
import { z } from 'zod/v4';

const usage: LanguageModelV4Usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 10,
    text: 10,
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

function createModel(): LanguageModelV4 {
  let callCount = 0;

  return {
    specificationVersion: 'v4',
    provider: 'issue-13199-reproduction',
    modelId: 'issue-13199-reproduction',
    supportedUrls: {},
    async doGenerate() {
      throw new Error('Not used by this reproduction.');
    },
    async doStream() {
      callCount++;

      if (callCount === 2) {
        return {
          stream: streamFrom([
            { type: 'text-start', id: 'text-2' },
            {
              type: 'text-delta',
              id: 'text-2',
              delta: 'Done replacing the text.',
            },
            { type: 'text-end', id: 'text-2' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage,
            },
          ]),
        };
      }

      return {
        stream: streamFrom([
          { type: 'text-start', id: 'text-1' },
          {
            type: 'text-delta',
            id: 'text-1',
            delta:
              'I will help replace Sunny with Rainy. First, I will read the file. ',
          },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'tool-call',
            toolCallId: 'tool-call-1',
            toolName: 'readFile',
            input: JSON.stringify({ path: 'hello.txt' }),
          },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
            usage,
          },
        ]),
      };
    },
  };
}

async function run({ smooth }: { smooth: boolean }) {
  const observed: string[] = [];

  const agent = new ToolLoopAgent({
    model: createModel(),
    tools: {
      readFile: tool({
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          observed.push(`[TOOL LOG ${path}]`);
          return 'One\nSunny\nDay';
        },
      }),
    },
  });

  const result = await agent.stream({
    prompt: 'Replace Sunny with Rainy in hello.txt',
    experimental_transform: smooth
      ? [smoothStream({ delayInMs: 50, chunking: 'word' })]
      : undefined,
  });

  for await (const text of result.textStream) {
    observed.push(text);
  }

  return { observed, renderedOutput: observed.join('') };
}

async function main() {
  const withoutSmoothStream = await run({ smooth: false });
  const withSmoothStream = await run({ smooth: true });

  console.log(
    JSON.stringify({ withoutSmoothStream, withSmoothStream }, null, 2),
  );

  const toolLogIndex = withSmoothStream.renderedOutput.indexOf(
    '[TOOL LOG hello.txt]',
  );
  const preToolTextEndIndex =
    withSmoothStream.renderedOutput.indexOf('read the file. ') +
    'read the file. '.length;

  if (toolLogIndex < preToolTextEndIndex) {
    throw new Error(
      'Reproduced issue #13199: smoothStream emitted a tool log before the preceding assistant text finished.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
