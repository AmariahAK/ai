import { createXai } from '@ai-sdk/xai';
import { generateText, stepCountIs, tool } from 'ai';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';

const fixturePath = path.resolve(
  '../../packages/xai/src/responses/__fixtures__/issue-17381-tool-image-result.live.json',
);

async function main() {
  const image = await sharp(
    Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="400">
        <rect width="800" height="400" fill="white"/>
        <text
          x="400"
          y="235"
          text-anchor="middle"
          font-family="Arial, sans-serif"
          font-size="150"
          font-weight="bold"
          fill="black"
        >BANANA</text>
      </svg>
    `),
  )
    .png()
    .toBuffer();
  const imageBase64 = image.toString('base64');

  const calls: Array<{
    requestBody: any;
    responseBody?: any;
  }> = [];

  const xai = createXai({
    fetch: async (input, init) => {
      const call: { requestBody: any; responseBody?: any } = {
        requestBody:
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);

      const response = await fetch(input, init);
      call.responseBody = await response
        .clone()
        .json()
        .catch(() => undefined);
      return response;
    },
  });

  const result = await generateText({
    model: xai.responses('grok-4.5'),
    maxOutputTokens: 64,
    prompt:
      'Call getFigure. Then read the single uppercase word in the returned image. Reply with only that word. If no image is available, reply exactly NO_IMAGE.',
    tools: {
      getFigure: tool({
        description: 'Returns an image containing a single uppercase word.',
        inputSchema: z.object({}),
        execute: async () => ({ image: imageBase64 }),
        toModelOutput: ({ output }) => ({
          type: 'content',
          value: [
            {
              type: 'text',
              text: 'Read the single uppercase word in the attached image.',
            },
            {
              type: 'image-data',
              data: output.image,
              mediaType: 'image/png',
            },
          ],
        }),
      }),
    },
    prepareStep: ({ stepNumber }) => ({
      toolChoice:
        stepNumber === 0 ? { type: 'tool', toolName: 'getFigure' } : 'none',
    }),
    stopWhen: stepCountIs(2),
  });

  const secondRequest = calls[1]?.requestBody;
  const toolOutput = secondRequest?.input?.find(
    (item: any) => item.type === 'function_call_output',
  )?.output;
  const hasInputImage =
    Array.isArray(toolOutput) &&
    toolOutput.some(
      (item: any) =>
        item.type === 'input_image' &&
        typeof item.image_url === 'string' &&
        item.image_url.startsWith('data:image/png;base64,'),
    );

  const correctedRequest = {
    ...secondRequest,
    input: secondRequest.input.map((item: any) =>
      item.type === 'function_call_output'
        ? {
            ...item,
            output: [
              {
                type: 'input_text',
                text: 'Read the single uppercase word in the attached image.',
              },
              {
                type: 'input_image',
                image_url: `data:image/png;base64,${imageBase64}`,
              },
            ],
          }
        : item,
    ),
  };
  const correctedHttpResponse = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(correctedRequest),
  });
  const correctedResponse = await correctedHttpResponse.json();
  if (!correctedHttpResponse.ok) {
    throw new Error(
      `Corrected xAI request failed with HTTP ${correctedHttpResponse.status}: ${JSON.stringify(correctedResponse)}`,
    );
  }
  const correctedText =
    correctedResponse.output
      ?.flatMap((item: any) => item.content ?? [])
      .find((item: any) => item.type === 'output_text')?.text ?? '';

  await fs.writeFile(
    fixturePath,
    `${JSON.stringify(
      {
        model: 'grok-4.5',
        imageBase64,
        responses: calls.map(call => call.responseBody),
        correctedResponse,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify(
      {
        requestCount: calls.length,
        observedToolOutput: toolOutput,
        hasInputImage,
        finalText: result.text,
        correctedText,
      },
      null,
      2,
    ),
  );

  if (
    result.text.trim().toUpperCase() !== 'BANANA' &&
    correctedText.trim().toUpperCase() === 'BANANA'
  ) {
    throw new Error(
      `Reproduced issue #17381: xAI could not read BANANA because @ai-sdk/xai dropped the tool-returned image; the SDK response was ${JSON.stringify(result.text.trim())}, while the corrected live xAI request returned BANANA.`,
    );
  }

  if (correctedText.trim().toUpperCase() !== 'BANANA') {
    throw new Error(
      `Expected the corrected live xAI request to return BANANA, but received ${JSON.stringify(correctedText.trim())}.`,
    );
  }

  if (!hasInputImage) {
    throw new Error(
      'Reproduced issue #17381: the xAI Responses request dropped the tool-returned image instead of sending input_image.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
