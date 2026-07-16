import 'dotenv/config';
import { createXai } from '@ai-sdk/xai';
import { generateText, isStepCount, tool } from 'ai';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { z } from 'zod';

const EXPECTED_CODE = 'ZXQ-731';
const LIVE_FIXTURE_PATH =
  '../../packages/xai/src/responses/__fixtures__/issue-17381-tool-result-image.json';

async function createTestImage(): Promise<string> {
  return (
    await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: 'white',
      },
    })
      .composite([
        {
          input: Buffer.from(`
            <svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
              <rect width="800" height="400" fill="white"/>
              <text
                x="400"
                y="235"
                text-anchor="middle"
                font-family="Arial, sans-serif"
                font-size="120"
                font-weight="bold"
                fill="black"
              >${EXPECTED_CODE}</text>
            </svg>
          `),
        },
      ])
      .png()
      .toBuffer()
  ).toString('base64');
}

async function callRawXai(imageData: string) {
  const headers = {
    Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    'Content-Type': 'application/json',
  };
  const tools = [
    {
      type: 'function',
      name: 'inspect_image',
      description: 'Returns the image whose code must be read.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  ];

  const toolCallResponse = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'grok-4.5',
      input:
        'Call inspect_image exactly once so you can read its image and then reply with only the exact uppercase code shown in the image.',
      tools,
      tool_choice: { type: 'function', name: 'inspect_image' },
    }),
  });
  const toolCallBody = (await toolCallResponse.json()) as {
    id?: string;
    output?: Array<{ type?: string; call_id?: string }>;
  };

  if (!toolCallResponse.ok) {
    throw new Error(
      `Raw xAI tool-call request failed: ${JSON.stringify(toolCallBody)}`,
    );
  }

  const callId = toolCallBody.output?.find(
    item => item.type === 'function_call',
  )?.call_id;
  if (toolCallBody.id == null || callId == null) {
    throw new Error(
      `Raw xAI response did not contain a function call: ${JSON.stringify(toolCallBody)}`,
    );
  }

  const imageResponse = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'grok-4.5',
      previous_response_id: toolCallBody.id,
      input: [
        {
          type: 'function_call_output',
          call_id: callId,
          output: [
            {
              type: 'input_text',
              text: 'The requested image is attached.',
            },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${imageData}`,
            },
          ],
        },
      ],
      tools,
    }),
  });
  const imageResponseBody = (await imageResponse.json()) as {
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  if (!imageResponse.ok) {
    throw new Error(
      `Raw xAI image tool-result request failed: ${JSON.stringify(imageResponseBody)}`,
    );
  }

  if (process.env.RECORD_LIVE_FIXTURE === '1') {
    await writeFile(
      LIVE_FIXTURE_PATH,
      `${JSON.stringify(imageResponseBody, null, 2)}\n`,
    );
  }

  const text = imageResponseBody.output
    ?.flatMap(item => item.content ?? [])
    .find(item => item.type === 'output_text')?.text;

  return { response: imageResponseBody, text };
}

async function main() {
  const requestBodies: unknown[] = [];
  const xai = createXai({
    fetch: async (input, init) => {
      if (typeof init?.body === 'string') {
        requestBodies.push(JSON.parse(init.body));
      }
      return fetch(input, init);
    },
  });

  const imageData = await createTestImage();
  const rawApiResult = await callRawXai(imageData);

  const result = await generateText({
    model: xai.responses('grok-4.5'),
    prompt:
      'Call inspectImage exactly once, read the image returned by the tool, and reply with only the exact uppercase code shown in the image.',
    tools: {
      inspectImage: tool({
        description: 'Returns the image whose code must be read.',
        inputSchema: z.object({}),
        execute: async () => ({ imageData }),
        toModelOutput: ({ output }) => ({
          type: 'content',
          value: [
            {
              type: 'text',
              text: 'The requested image is attached.',
            },
            {
              type: 'file',
              mediaType: 'image/png',
              data: { type: 'data', data: output.imageData },
            },
          ],
        }),
      }),
    },
    stopWhen: isStepCount(3),
  });

  const toolResultRequest = requestBodies.find(body => {
    if (body == null || typeof body !== 'object' || !('input' in body)) {
      return false;
    }
    return (
      Array.isArray(body.input) &&
      body.input.some(
        item =>
          item != null &&
          typeof item === 'object' &&
          'type' in item &&
          item.type === 'function_call_output',
      )
    );
  });

  console.log(
    JSON.stringify(
      {
        assistantText: result.text,
        rawApiText: rawApiResult.text,
        toolResultRequest,
      },
      null,
      2,
    ),
  );

  if (!rawApiResult.text?.toUpperCase().includes(EXPECTED_CODE)) {
    throw new Error(
      `Raw xAI API did not read the expected code: ${JSON.stringify(rawApiResult.response)}`,
    );
  }

  if (!result.text.toUpperCase().includes(EXPECTED_CODE)) {
    throw new Error(
      'ISSUE_17381_REPRODUCED: xAI could not read the code because the tool-result image was dropped.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
