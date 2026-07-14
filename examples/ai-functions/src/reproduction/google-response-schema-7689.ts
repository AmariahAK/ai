import assert from 'node:assert/strict';
import { createGoogleGenerativeAI } from '../../../../packages/google/dist/index.mjs';
import {
  generateObject,
  jsonSchema,
} from '../../../../packages/ai/dist/index.mjs';

let requestBody: unknown;
let responseStatus: number | undefined;
let responseBody: unknown;

const google = createGoogleGenerativeAI({
  fetch: async (url, init) => {
    requestBody = JSON.parse(String(init?.body));

    const response = await fetch(url, init);
    responseStatus = response.status;
    responseBody = await response
      .clone()
      .json()
      .catch(async () => await response.clone().text());

    return response;
  },
});

async function main() {
  const result = await generateObject({
    model: google('gemini-2.5-flash'),
    schema: jsonSchema<{ location: string }>({
      type: 'object',
      properties: {
        location: { type: 'string' },
      },
      required: ['location'],
      additionalProperties: false,
    }),
    prompt: 'Return the location Paris.',
  });

  const generationConfig = (
    requestBody as {
      generationConfig?: {
        responseSchema?: {
          type?: string;
          properties?: { location?: { type?: string } };
        };
      };
    }
  ).generationConfig;

  assert.equal(generationConfig?.responseSchema?.type, 'object');
  assert.equal(
    generationConfig.responseSchema.properties?.location?.type,
    'string',
  );
  assert.equal(
    responseStatus,
    200,
    `Expected Google to accept responseSchema with lowercase JSON Schema types, received ${responseStatus}: ${JSON.stringify(responseBody)}`,
  );
  assert.equal(typeof result.object.location, 'string');

  console.log(
    JSON.stringify(
      {
        requestBody,
        responseStatus,
        responseBody,
        object: result.object,
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
