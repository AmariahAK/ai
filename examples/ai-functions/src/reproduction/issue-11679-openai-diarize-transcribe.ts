import 'dotenv/config';

import { openai } from '@ai-sdk/openai';
import { APICallError, transcribe } from 'ai';
import { readFile } from 'node:fs/promises';

async function main() {
  try {
    await transcribe({
      model: openai.transcription('gpt-4o-transcribe-diarize'),
      audio: await readFile('data/galileo.mp3'),
      providerOptions: {
        openai: {
          // These snake_case options are the options requested in #11679.
          // They are intentionally cast because the current OpenAI provider
          // option schema does not expose them.
          chunking_strategy: 'auto',
          response_format: 'json',
        } as any,
      },
    });

    throw new Error(
      'Issue #11679 was not reproduced: diarized transcription unexpectedly succeeded.',
    );
  } catch (error) {
    if (!APICallError.isInstance(error)) {
      throw error;
    }

    console.error('OpenAI transcription API call failed.');
    console.error('Status code:', error.statusCode);
    console.error('Request body values:', error.requestBodyValues);
    console.error('Response body:', error.responseBody);

    const responseBody = String(error.responseBody ?? '');
    if (
      error.statusCode === 400 &&
      responseBody.includes("response_format 'verbose_json' is not compatible")
    ) {
      throw new Error(
        'Reproduced issue #11679: providerOptions.openai.response_format was set to "json", but the API received/validated "verbose_json".',
        { cause: error },
      );
    }

    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
