import { openai } from '@ai-sdk/openai';
import { smoothStream, streamText, tool } from 'ai';
import { z } from 'zod/v4';

async function main() {
  let completeTextBeforeTool: string | undefined;
  let streamedText = '';
  let textObservedWhenToolExecuted: string | undefined;

  const result = streamText({
    model: openai('gpt-4o'),
    prompt:
      'You must complete these actions in order: ' +
      '(1) output exactly "I will read hello.txt now. " including the trailing space, ' +
      '(2) call the readFile tool with path "hello.txt".',
    tools: {
      readFile: tool({
        description: 'Read a file.',
        inputSchema: z.object({ path: z.string() }),
        execute: async () => {
          textObservedWhenToolExecuted = streamedText;
          return 'Sunny';
        },
      }),
    },
    experimental_transform: smoothStream({
      delayInMs: 50,
      chunking: 'word',
    }),
    onLanguageModelCallEnd: event => {
      completeTextBeforeTool = event.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('');
    },
  });

  for await (const text of result.textStream) {
    streamedText += text;
  }

  console.log(
    JSON.stringify(
      {
        completeTextBeforeTool,
        textObservedWhenToolExecuted,
        finalStreamedText: streamedText,
      },
      null,
      2,
    ),
  );

  if (completeTextBeforeTool == null || completeTextBeforeTool.length === 0) {
    throw new Error('The model did not emit text before the tool call.');
  }

  if (textObservedWhenToolExecuted !== completeTextBeforeTool) {
    throw new Error(
      'The tool executed before smoothStream emitted all preceding assistant text.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
