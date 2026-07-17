import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { readFile } from 'node:fs/promises';

async function main() {
  const recordedResponse = JSON.parse(
    await readFile(
      new URL(
        '../../../../packages/google/src/__fixtures__/google-code-execution-multiple-results.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );

  const google = createGoogleGenerativeAI({
    apiKey: 'test-api-key',
    generateId: () => 'code-execution-call',
    fetch: async () =>
      new Response(JSON.stringify(recordedResponse), {
        headers: { 'content-type': 'application/json' },
      }),
  });

  try {
    const result = await generateText({
      model: google('gemini-3-flash-preview'),
      prompt:
        "use code execution to execute the following code snippet:\nprint('ok')\nprint(1/0)",
      tools: {
        code_execution: google.tools.codeExecution({}),
      },
    });

    const toolResults = result.content.filter(
      part => part.type === 'tool-result',
    );

    if (toolResults.length !== 2) {
      throw new Error(
        `Expected generateText to return both code execution results, but received ${toolResults.length}.`,
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Tool call undefined not found.'
    ) {
      throw new Error(
        'Reproduced issue #11485: generateText threw "Tool call undefined not found." for one executableCode with two codeExecutionResult parts.',
      );
    }

    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
