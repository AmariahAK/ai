import { createGoogleVertex } from '@ai-sdk/google-vertex';
import assert from 'node:assert/strict';
import { generateText, tool } from 'ai';
import { z } from 'zod/v4';

type CapturedRequest = {
  tools?: Array<{
    functionDeclarations?: Array<{
      name: string;
      parameters?: unknown;
    }>;
  }>;
};

function createCapturingFetch(capturedBodies: CapturedRequest[]) {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(init?.body as string));

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'ok' }],
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };
}

async function captureToolParameters(toolDefinition: unknown) {
  const capturedBodies: CapturedRequest[] = [];
  const vertex = createGoogleVertex({
    apiKey: 'test-api-key',
    fetch: createCapturingFetch(capturedBodies),
  });

  await generateText({
    model: vertex('gemini-2.5-flash'),
    prompt: 'Read package.json',
    tools: {
      readFile: tool(toolDefinition as never),
    },
  });

  return capturedBodies[0]?.tools?.[0]?.functionDeclarations?.[0]?.parameters;
}

async function main() {
  const expectedVertexParameters = {
    type: 'object',
    properties: {
      filePath: { type: 'string' },
    },
    required: ['filePath'],
  };

  const controlParameters = await captureToolParameters({
    description: 'Read a file',
    inputSchema: z.object({
      filePath: z.string(),
    }),
    execute: async ({ filePath }: { filePath: string }) => filePath,
  });

  try {
    assert.deepStrictEqual(controlParameters, expectedVertexParameters);
  } catch {
    throw new Error(
      `Control failed: inputSchema did not serialize as expected.\n` +
        `Expected: ${JSON.stringify(expectedVertexParameters)}\n` +
        `Received: ${JSON.stringify(controlParameters)}`,
    );
  }

  const reportedParameters = await captureToolParameters({
    description: 'Read a file',
    // This is the call shape from vercel/ai#12143. It is cast through
    // `unknown` above so the runtime behavior can be reproduced in this
    // AI SDK v7 worktree, where TypeScript users are directed to
    // `inputSchema`.
    parameters: z.object({
      filePath: z.string(),
    }),
    execute: async ({ filePath }: { filePath: string }) => filePath,
  });

  try {
    assert.deepStrictEqual(reportedParameters, expectedVertexParameters);
  } catch {
    throw new Error(
      `Reproduced vercel/ai#12143: the reported Zod tool schema was not ` +
        `serialized into Vertex functionDeclaration.parameters.\n` +
        `Expected: ${JSON.stringify(expectedVertexParameters)}\n` +
        `Received: ${JSON.stringify(reportedParameters)}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
