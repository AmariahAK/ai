import { smoothStream, tool, ToolLoopAgent } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod/v4';

const usage = {
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

async function main() {
  const useSmoothStream = !process.argv.includes('--without-smooth-stream');
  const textBeforeTool =
    'I will help replace Sunny with Rainy. First, let me read the file. ';
  let streamedText = '';
  let textObservedWhenToolExecuted: string | undefined;

  const model = new MockLanguageModelV4({
    doStream: [
      {
        stream: convertArrayToReadableStream([
          { type: 'text-start', id: 'text-1' },
          {
            type: 'text-delta',
            id: 'text-1',
            delta: textBeforeTool,
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
      },
      {
        stream: convertArrayToReadableStream([
          { type: 'text-start', id: 'text-2' },
          {
            type: 'text-delta',
            id: 'text-2',
            delta: 'The file contains Sunny.',
          },
          { type: 'text-end', id: 'text-2' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage,
          },
        ]),
      },
    ],
  });

  const agent = new ToolLoopAgent({
    model,
    tools: {
      readFile: tool({
        inputSchema: z.object({ path: z.string() }),
        execute: async () => {
          textObservedWhenToolExecuted = streamedText;
          return 'Sunny';
        },
      }),
    },
  });

  const result = await agent.stream({
    prompt: 'Replace Sunny with Rainy in hello.txt',
    experimental_transform: useSmoothStream
      ? smoothStream({
          delayInMs: 50,
          chunking: 'word',
        })
      : undefined,
  });

  for await (const text of result.textStream) {
    streamedText += text;
  }

  console.log(
    JSON.stringify(
      {
        useSmoothStream,
        expectedTextBeforeTool: textBeforeTool,
        textObservedWhenToolExecuted,
        finalStreamedText: streamedText,
      },
      null,
      2,
    ),
  );

  if (textObservedWhenToolExecuted !== textBeforeTool) {
    throw new Error(
      useSmoothStream
        ? 'Issue #13199 reproduced: the tool executed before smoothStream emitted all preceding assistant text.'
        : 'Unexpected baseline failure: the tool executed before all preceding assistant text was emitted without smoothStream.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
