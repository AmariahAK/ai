import { createXai } from '@ai-sdk/xai';
import { streamText, tool, TypeValidationError } from 'ai';
import { z } from 'zod';

type CapturedExchange = {
  requestBody?: string;
  responseBody: string;
  status: number;
};

async function main() {
  let exchange: CapturedExchange | undefined;

  const recordingFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const responseBody = await response.clone().text();

    exchange = {
      requestBody: typeof init?.body === 'string' ? init.body : undefined,
      responseBody,
      status: response.status,
    };

    return response;
  };

  const xai = createXai({ fetch: recordingFetch });
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

  const parts: unknown[] = [];
  let text = '';
  let typeValidationError: TypeValidationError | undefined;

  try {
    for await (const part of result.fullStream) {
      parts.push(part);

      if (part.type === 'text-delta') {
        text += part.text;
      }

      if (part.type === 'error' && TypeValidationError.isInstance(part.error)) {
        typeValidationError = part.error;
      }
    }
  } catch (error) {
    if (TypeValidationError.isInstance(error)) {
      typeValidationError = error;
    } else {
      throw error;
    }
  } finally {
    const responseChunks = exchange?.responseBody
      .split('\n')
      .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
      .map(line => line.slice('data: '.length));

    console.log(
      JSON.stringify(
        {
          requestBody: exchange?.requestBody,
          responseChunks,
          status: exchange?.status,
          parts,
          text,
        },
        null,
        2,
      ),
    );
  }

  if (typeValidationError != null) {
    throw new Error(
      `Issue #14932 reproduced: xAI stream error surfaced as ${typeValidationError.name}: ${typeValidationError.message}`,
    );
  }

  console.log(
    'Issue #14932 was not reproduced: no AI_TypeValidationError was observed.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
