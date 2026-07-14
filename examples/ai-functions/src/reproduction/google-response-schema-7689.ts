import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, Output } from 'ai';
import 'dotenv/config';
import { z } from 'zod';

async function main() {
  let requestBody: unknown;
  let responseBody: unknown;
  let responseStatus: number | undefined;

  const google = createGoogleGenerativeAI({
    fetch: async (input, init) => {
      requestBody =
        typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;

      const response = await fetch(input, init);
      responseStatus = response.status;

      const responseText = await response.clone().text();
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }

      return response;
    },
  });

  const result = await generateText({
    model: google('gemini-2.5-flash'),
    output: Output.object({
      schema: z.object({
        location: z.string(),
      }),
    }),
    prompt: 'Return the location "Paris".',
  });

  if (result.output.location !== 'Paris') {
    throw new Error(
      `Expected the structured output location to be "Paris", received ${JSON.stringify(result.output)}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        requestBody,
        responseStatus,
        responseBody,
        output: result.output,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
