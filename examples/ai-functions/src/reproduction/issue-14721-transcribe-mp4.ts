import { createOpenAI } from '@ai-sdk/openai';
import { APICallError } from '@ai-sdk/provider';
import { experimental_transcribe as transcribe } from 'ai';

type RequestObservation = {
  fileName: string;
  fileSize: number;
  mediaType: string;
  responseBody: string;
  status: number;
};

async function main() {
  const fixtureResponse = await fetch(
    'https://raw.githubusercontent.com/aamikus/ai-sdk-transcribe-m4a-repro/650167f52d6c1fe427ffd7ba8fbed622ef312010/fixture/sample.m4a',
  );
  if (!fixtureResponse.ok) {
    throw new Error(
      `Failed to download the issue fixture: ${fixtureResponse.status}`,
    );
  }

  const audio = new Uint8Array(await fixtureResponse.arrayBuffer());
  const observations: RequestObservation[] = [];
  const openai = createOpenAI({
    fetch: async (input, init) => {
      if (!(init?.body instanceof FormData)) {
        throw new Error('Expected the OpenAI request body to be FormData.');
      }

      const file = init.body.get('file');
      if (!(file instanceof File)) {
        throw new Error('Expected the OpenAI request to contain a file.');
      }

      const response = await fetch(input, init);
      observations.push({
        fileName: file.name,
        fileSize: file.size,
        mediaType: file.type,
        responseBody: await response.clone().text(),
        status: response.status,
      });
      return response;
    },
  });
  const model = openai.transcription('gpt-4o-mini-transcribe');

  const directResult = await model.doGenerate({
    audio,
    mediaType: 'audio/mp4',
  });

  let wrapperError: unknown;
  try {
    await transcribe({
      model,
      audio,
      maxRetries: 0,
    });
  } catch (error) {
    wrapperError = error;
  }

  console.log(
    JSON.stringify(
      {
        bytes0To15: Array.from(audio.subarray(0, 16)),
        directText: directResult.text,
        observations,
        wrapperError: APICallError.isInstance(wrapperError)
          ? {
              responseBody: wrapperError.responseBody,
              statusCode: wrapperError.statusCode,
            }
          : wrapperError instanceof Error
            ? {
                message: wrapperError.message,
                name: wrapperError.name,
              }
            : wrapperError,
      },
      null,
      2,
    ),
  );

  const directRequest = observations[0];
  const wrapperRequest = observations[1];
  if (
    directResult.text &&
    directRequest?.mediaType === 'audio/mp4' &&
    directRequest.fileName === 'audio.m4a' &&
    wrapperRequest?.mediaType === 'audio/wav' &&
    wrapperRequest.fileName === 'audio.wav' &&
    APICallError.isInstance(wrapperError) &&
    wrapperError.statusCode === 400 &&
    wrapperError.responseBody?.includes('unsupported_format')
  ) {
    throw new Error(
      'ISSUE_14721_REPRODUCED: transcribe uploaded MP4 bytes as audio/wav and OpenAI rejected them with 400 unsupported_format while direct audio/mp4 transcription succeeded',
    );
  }

  throw new Error(
    'ISSUE_14721_NOT_REPRODUCED: the observed final OpenAI behavior did not match the report',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
