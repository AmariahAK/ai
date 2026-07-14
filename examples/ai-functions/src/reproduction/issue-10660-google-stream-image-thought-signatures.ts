import { google, type GoogleLanguageModelOptions } from '@ai-sdk/google';
import { streamText } from 'ai';

const modelId = 'gemini-3-pro-image-preview';
const firstPrompt =
  'Create a simple square image of a yellow moon in a black sky.';

const providerOptions = {
  google: {
    responseModalities: ['TEXT', 'IMAGE'],
  } satisfies GoogleLanguageModelOptions,
};

async function main() {
  const first = streamText({
    model: google(modelId),
    prompt: firstPrompt,
    providerOptions,
  });

  let streamedImageCount = 0;
  let signedStreamedImageCount = 0;
  const turn1EventTypes: string[] = [];

  for await (const part of first.fullStream) {
    turn1EventTypes.push(part.type);

    if (part.type === 'error') {
      throw part.error;
    }

    if (part.type === 'file' && part.file.mediaType.startsWith('image/')) {
      streamedImageCount++;

      if (typeof part.providerMetadata?.google?.thoughtSignature === 'string') {
        signedStreamedImageCount++;
      }
    }
  }

  if (streamedImageCount === 0) {
    throw new Error(
      `Turn 1 did not stream an image. finishReason=${await first.finishReason}; text=${JSON.stringify(await first.text)}; eventTypes=${JSON.stringify(turn1EventTypes)}`,
    );
  }

  if (signedStreamedImageCount === 0) {
    throw new Error(
      'Issue #10660 reproduced: the streamed image had no Google thoughtSignature.',
    );
  }

  const firstResponseMessages = (await first.response).messages;
  const signedHistoryImageCount = firstResponseMessages.reduce(
    (count, message) => {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) {
        return count;
      }

      return (
        count +
        message.content.filter(
          part =>
            part.type === 'file' &&
            typeof part.providerOptions?.google?.thoughtSignature === 'string',
        ).length
      );
    },
    0,
  );

  if (signedHistoryImageCount === 0) {
    throw new Error(
      'Issue #10660 reproduced: streamText did not preserve the image thoughtSignature in response history.',
    );
  }

  const second = streamText({
    model: google(modelId),
    messages: [
      { role: 'user', content: firstPrompt },
      ...firstResponseMessages,
      {
        role: 'user',
        content: 'Nice, but now make the moon look like Swiss cheese.',
      },
    ],
    providerOptions,
  });

  let refinedImageCount = 0;

  for await (const part of second.fullStream) {
    if (part.type === 'error') {
      throw part.error;
    }

    if (part.type === 'file' && part.file.mediaType.startsWith('image/')) {
      refinedImageCount++;
    }
  }

  if (refinedImageCount === 0) {
    throw new Error(
      'Issue #10660 reproduced: the follow-up streaming turn did not produce a refined image.',
    );
  }

  console.log(
    JSON.stringify(
      {
        modelId,
        streamedImageCount,
        signedStreamedImageCount,
        signedHistoryImageCount,
        refinedImageCount,
        result: 'The streamed image signature round-tripped successfully.',
      },
      null,
      2,
    ),
  );
}

main();
