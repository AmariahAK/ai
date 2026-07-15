import { createGoogle } from '@ai-sdk/google';
import { generateText } from 'ai';
import fs from 'node:fs/promises';

async function main() {
  let requestBody: unknown;
  let responseBody: any;
  const recordedResponse = JSON.parse(
    await fs.readFile(
      new URL(
        '../../../../packages/google/src/__fixtures__/google-code-execution-multiple-results.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );

  const google = createGoogle({
    apiKey: 'recorded-fixture',
    fetch: async (input, init) => {
      if (typeof init?.body === 'string') {
        requestBody = JSON.parse(init.body);
      }

      responseBody = recordedResponse;
      return new Response(JSON.stringify(recordedResponse), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    },
  });

  let generateTextError: unknown;

  try {
    await generateText({
      model: google('gemini-3-flash-preview'),
      prompt:
        "use code execution to execute the following code snippet:\nprint('ok')\nprint(1/0)",
      tools: {
        code_execution: google.tools.codeExecution({}),
      },
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: 'minimal',
          },
        },
      },
    });
  } catch (error) {
    generateTextError = error;
  }

  const parts = responseBody?.candidates?.[0]?.content?.parts ?? [];
  const executableCodeCount = parts.filter(
    (part: any) => part.executableCode != null,
  ).length;
  const codeExecutionResultCount = parts.filter(
    (part: any) => part.codeExecutionResult != null,
  ).length;
  const errorMessage =
    generateTextError instanceof Error
      ? generateTextError.message
      : String(generateTextError);

  console.log(
    JSON.stringify(
      {
        requestBody,
        responseBody,
        executableCodeCount,
        codeExecutionResultCount,
        generateTextError: generateTextError == null ? null : errorMessage,
      },
      null,
      2,
    ),
  );

  if (
    executableCodeCount === 1 &&
    codeExecutionResultCount > 1 &&
    errorMessage === 'Tool call undefined not found.'
  ) {
    throw new Error(
      'Reproduced issue #11485: generateText threw after Gemini returned multiple codeExecutionResult parts for one executableCode part.',
      { cause: generateTextError },
    );
  }

  if (generateTextError != null) {
    throw generateTextError;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
