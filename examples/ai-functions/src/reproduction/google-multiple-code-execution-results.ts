import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { readFile } from 'node:fs/promises';

async function main() {
  const response = await readFile(
    new URL(
      '../../../../packages/google/src/__fixtures__/google-code-execution-multiple-results.json',
      import.meta.url,
    ),
    'utf8',
  );

  const google = createGoogleGenerativeAI({
    apiKey: 'reproduction-api-key',
    generateId: () => 'code-execution-call',
    fetch: async () =>
      new Response(response, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  await generateText({
    model: google('gemini-3-flash-preview'),
    tools: {
      code_execution: google.tools.codeExecution({}),
    },
    prompt:
      "use code execution to execute the following code snippet:\nprint('ok')\nprint(1/0)",
  });

  console.log('Issue #11485 did not reproduce.');
}

main().catch(error => {
  console.error(
    `ISSUE_11485_REPRODUCED: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
