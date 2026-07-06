import { openai } from '@ai-sdk/openai';
import { APICallError, generateText, Output } from 'ai';
import { z } from 'zod/v4';

async function main() {
  console.log(
    'Reproducing issue #11701 with generateText({ output }) and a top-level array schema.',
  );
  console.log(
    'This uses the OpenAI provider path (not AI Gateway) because live AI Gateway checks are skipped by policy.',
  );

  try {
    const result = await generateText({
      model: openai('gpt-4o-mini'),
      maxRetries: 0,
      prompt: 'Return 3 random words',
      output: Output.object({
        schema: z.array(
          z.object({
            word: z.string(),
            category: z.string(),
          }),
        ),
      }),
    });

    console.log('Unexpected success:', JSON.stringify(result.output));
  } catch (error) {
    if (APICallError.isInstance(error)) {
      console.error('Provider APICallError:', error.message);
      console.error('Status code:', error.statusCode);
      console.error('Response body:', error.responseBody);
      console.error(
        'Request body:',
        JSON.stringify(error.requestBodyValues, null, 2),
      );
      throw error;
    }

    console.error(error);
    throw error;
  }
}

main().catch(() => {
  process.exitCode = 1;
});
