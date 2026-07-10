import { createXai } from '@ai-sdk/xai';
import { TypeValidationError } from '@ai-sdk/provider';
import { streamText, tool } from 'ai';
import { z } from 'zod';

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error as any),
    };
  }

  return error;
}

async function main() {
  let requestBody: string | undefined;
  let responseStatus: number | undefined;
  let rawResponsePromise: Promise<string> | undefined;

  const xai = createXai({
    fetch: async (input, init) => {
      if (typeof init?.body === 'string') {
        requestBody = init.body;
      }

      const response = await fetch(input, init);
      responseStatus = response.status;
      rawResponsePromise = response.clone().text();
      return response;
    },
  });

  const parts: unknown[] = [];
  let thrownError: unknown;

  try {
    const result = streamText({
      model: xai.responses('grok-4.3'),
      prompt: 'Reply OK. Do not use tools.',
      tools: {
        image_generation: tool({
          description: 'Generate image',
          inputSchema: z.object({
            prompt: z.string(),
            model: z
              .enum(['fal-ai/flux-2-pro', 'fal-ai/qwen-image-edit'])
              .optional(),
          }),
          execute: async () => ({ ok: true }),
        }),
      },
      maxOutputTokens: 8,
    });

    for await (const part of result.fullStream) {
      parts.push(part);
    }
  } catch (error) {
    thrownError = error;
  }

  const rawResponse = await rawResponsePromise;
  const errorParts = parts.filter(
    (part): part is { type: 'error'; error: unknown } =>
      typeof part === 'object' &&
      part != null &&
      'type' in part &&
      part.type === 'error' &&
      'error' in part,
  );
  const validationError =
    errorParts.find(part => TypeValidationError.isInstance(part.error))
      ?.error ??
    (TypeValidationError.isInstance(thrownError) ? thrownError : undefined);

  console.log(
    JSON.stringify(
      {
        requestBody: requestBody == null ? undefined : JSON.parse(requestBody),
        responseStatus,
        rawResponse,
        parts: parts.map(part =>
          typeof part === 'object' &&
          part != null &&
          'type' in part &&
          part.type === 'error' &&
          'error' in part
            ? { ...part, error: serializeError(part.error) }
            : part,
        ),
        thrownError: serializeError(thrownError),
      },
      null,
      2,
    ),
  );

  if (validationError != null) {
    throw new Error(
      'Reproduced issue #14932: xAI Responses API error event surfaced as AI_TypeValidationError.',
      { cause: validationError },
    );
  }

  if (errorParts.length > 0) {
    const providerError = errorParts[0].error;

    if (
      typeof providerError !== 'object' ||
      providerError == null ||
      !('type' in providerError) ||
      providerError.type !== 'error' ||
      !('message' in providerError) ||
      typeof providerError.message !== 'string' ||
      !('code' in providerError) ||
      !('param' in providerError)
    ) {
      throw new Error(
        'xAI returned an error stream part, but the original provider error fields were not preserved.',
      );
    }
  }

  if (thrownError != null) {
    const statusCode =
      typeof thrownError === 'object' &&
      thrownError != null &&
      'statusCode' in thrownError
        ? thrownError.statusCode
        : undefined;

    if ([401, 402, 403, 429].includes(Number(statusCode))) {
      throw thrownError;
    }

    // A concise non-validation provider/API error does not reproduce the issue.
    return;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
