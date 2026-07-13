import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, jsonSchema, tool } from 'ai';
import assert from 'node:assert/strict';
import { z } from 'zod';

const propertyName = 'userInputExactlyAsIs';
const propertyDescription =
  "The user's prompt as is, do not modify it or infer. Copy it verbatim.";
const prompt =
  'Show me quarterly sales for the Seattle waterfront kiosk, location code SEA-WF-042.';
const requestBodies: string[] = [];
const google = createGoogleGenerativeAI({
  fetch: async (url, init) => {
    if (typeof init?.body === 'string') {
      requestBodies.push(init.body);
    }
    return fetch(url, init);
  },
});

async function generateToolInput(
  schema:
    | ReturnType<typeof jsonSchema<{ userInputExactlyAsIs: string }>>
    | z.ZodObject<{ userInputExactlyAsIs: z.ZodString }>,
) {
  const result = await generateText({
    model: google('gemini-2.5-flash'),
    temperature: 0,
    tools: {
      capture: tool({
        description: 'Capture the requested value.',
        inputSchema: schema,
      }),
    },
    toolChoice: { type: 'tool', toolName: 'capture' },
    prompt,
  });

  assert.equal(result.toolCalls.length, 1, 'expected one forced tool call');

  return result.toolCalls[0].input as {
    userInputExactlyAsIs: string;
  };
}

async function main() {
  const zodSchema = z.object({
    [propertyName]: z.string().describe(propertyDescription),
  });
  const zodResults = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    zodResults.push(await generateToolInput(zodSchema));
  }

  const jsonSchemaResult = await generateToolInput(
    jsonSchema<{ userInputExactlyAsIs: string }>({
      type: 'object',
      properties: {
        [propertyName]: {
          type: 'string',
          description: propertyDescription,
        },
      },
      required: [propertyName],
      additionalProperties: false,
    }),
  );

  console.log(
    JSON.stringify(
      {
        model: 'gemini-2.5-flash',
        prompt,
        propertyDescription,
        requestBodies,
        zod: zodResults,
        jsonSchema: jsonSchemaResult,
      },
      null,
      2,
    ),
  );

  for (const zodResult of zodResults) {
    assert.equal(
      zodResult.userInputExactlyAsIs,
      prompt,
      'Gemini should copy the prompt verbatim instead of summarizing it',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
