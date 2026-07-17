import { createXai } from '../../../ai-core/node_modules/@ai-sdk/xai/dist/index.mjs';
import {
  generateText,
  stepCountIs,
  tool,
} from '../../../ai-core/node_modules/ai/dist/index.mjs';
import { deflateSync } from 'node:zlib';
import { z } from '../../../ai-core/node_modules/zod/index.js';

const EXPECTED_CODE = 'BANANA';

const glyphs: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
};

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createCodePng(): Buffer {
  const width = 900;
  const height = 260;
  const scale = 24;
  const glyphWidth = 5 * scale;
  const gap = scale;
  const textWidth =
    EXPECTED_CODE.length * glyphWidth + (EXPECTED_CODE.length - 1) * gap;
  const xOffset = Math.floor((width - textWidth) / 2);
  const yOffset = Math.floor((height - 7 * scale) / 2);
  const rows = Buffer.alloc(height * (1 + width * 3), 255);

  for (let y = 0; y < height; y++) {
    rows[y * (1 + width * 3)] = 0;
  }

  for (const [characterIndex, character] of [...EXPECTED_CODE].entries()) {
    const glyph = glyphs[character];
    for (const [glyphY, row] of glyph.entries()) {
      for (const [glyphX, pixel] of [...row].entries()) {
        if (pixel !== '1') {
          continue;
        }
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x =
              xOffset +
              characterIndex * (glyphWidth + gap) +
              glyphX * scale +
              dx;
            const y = yOffset + glyphY * scale + dy;
            const offset = y * (1 + width * 3) + 1 + x * 3;
            rows[offset] = 0;
            rows[offset + 1] = 0;
            rows[offset + 2] = 0;
          }
        }
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function responseText(response: any): string {
  return (response.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .filter((part: any) => part.type === 'output_text')
    .map((part: any) => part.text)
    .join('');
}

async function main() {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'XAI_API_KEY is required for this live-provider reproduction',
    );
  }

  const imageBase64 = createCodePng().toString('base64');
  const requestBodies: any[] = [];
  const responseBodies: any[] = [];
  const trackedFetch: typeof fetch = async (input, init) => {
    if (typeof init?.body === 'string') {
      requestBodies.push(JSON.parse(init.body));
    }
    const response = await fetch(input, init);
    responseBodies.push(await response.clone().json());
    return response;
  };
  const xai = createXai({ apiKey, fetch: trackedFetch });

  const sdkResult = await generateText({
    model: xai.responses('grok-4.5'),
    prompt:
      'Call inspectImage once. Then read the exact code shown in the returned image. If no image is visible, answer exactly NO_IMAGE.',
    tools: {
      inspectImage: tool({
        description: 'Returns an image containing a code that must be read.',
        inputSchema: z.object({}),
        execute: async () => ({ imageBase64 }),
        toModelOutput: () => ({
          type: 'content',
          value: [
            {
              type: 'text',
              text: 'Read the exact code in the attached image. If there is no attached image, answer exactly NO_IMAGE.',
            },
            {
              type: 'media',
              mediaType: 'image/png',
              data: imageBase64,
            },
          ],
        }),
      }),
    },
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0
        ? {
            activeTools: ['inspectImage'],
            toolChoice: { type: 'tool', toolName: 'inspectImage' },
          }
        : { activeTools: [], toolChoice: 'none' },
    stopWhen: stepCountIs(2),
    temperature: 0,
    maxOutputTokens: 100,
  });

  const sdkSecondRequest = requestBodies.find(body =>
    body.input?.some((item: any) => item.type === 'function_call_output'),
  );
  if (!sdkSecondRequest) {
    throw new Error('Live SDK call did not produce a tool-result request');
  }

  const correctedRequest = structuredClone(sdkSecondRequest);
  const correctedOutput = correctedRequest.input.find(
    (item: any) => item.type === 'function_call_output',
  );
  correctedOutput.output = [
    {
      type: 'input_text',
      text: 'Read the exact code in the attached image. If there is no attached image, answer exactly NO_IMAGE.',
    },
    {
      type: 'input_image',
      image_url: `data:image/png;base64,${imageBase64}`,
    },
  ];

  const correctedHttpResponse = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(correctedRequest),
  });
  const correctedResponse = await correctedHttpResponse.json();
  if (!correctedHttpResponse.ok) {
    throw new Error(
      `Corrected live xAI request failed with ${correctedHttpResponse.status}: ${JSON.stringify(correctedResponse)}`,
    );
  }

  const correctedText = responseText(correctedResponse);
  const sdkFunctionCallOutput = sdkSecondRequest.input.find(
    (item: any) => item.type === 'function_call_output',
  )?.output;

  console.log(
    `ISSUE_17381_LIVE_FIXTURE=${JSON.stringify({
      model: 'grok-4.5',
      sdkText: sdkResult.text,
      correctedText,
      sdkFunctionCallOutput,
      correctedFunctionCallOutput: correctedOutput.output.map((part: any) =>
        part.type === 'input_image'
          ? {
              type: 'input_image',
              image_url: '<data:image/png;base64,...>',
            }
          : part,
      ),
      sdkFinalResponse: responseBodies.at(-1),
      correctedResponse,
    })}`,
  );

  if (!correctedText.includes(EXPECTED_CODE)) {
    throw new Error(
      `Corrected xAI request did not read ${EXPECTED_CODE}; received: ${correctedText}`,
    );
  }

  if (sdkResult.text.includes(EXPECTED_CODE)) {
    console.log(
      `Issue not reproduced: the SDK-delivered tool image was read as ${EXPECTED_CODE}.`,
    );
    return;
  }

  console.error(
    `ISSUE_17381_REPRODUCED: corrected xAI request read ${EXPECTED_CODE}, but generateText received "${sdkResult.text}" after the SDK omitted the tool-result image.`,
  );
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
