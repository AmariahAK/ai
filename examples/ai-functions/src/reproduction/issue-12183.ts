import { generateText, jsonSchema, tool } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex';

type CapturedRequest = {
  url: string;
  body: any;
};

const successfulVertexResponse = {
  candidates: [
    {
      content: {
        parts: [{ text: 'ok' }],
        role: 'model',
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
};

function createCapturingVertex() {
  const requests: CapturedRequest[] = [];

  const vertex = createVertex({
    project: 'my-project',
    location: 'us-central1',
    apiKey: 'test-api-key',
    fetch: async (url, init) => {
      requests.push({
        url: url.toString(),
        body: JSON.parse(String(init?.body)),
      });

      return new Response(JSON.stringify(successfulVertexResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  return { vertex, requests };
}

async function runStandardManualToolCheck() {
  const { vertex, requests } = createCapturingVertex();

  await generateText({
    model: vertex('gemini-2.5-pro'),
    system: 'Use tools when needed',
    messages: [{ role: 'user', content: 'Read package.json' }],
    tools: {
      readFile: tool({
        description: 'Read a file',
        inputSchema: jsonSchema({
          type: 'object',
          properties: {
            filePath: { type: 'string' },
          },
          required: ['filePath'],
          additionalProperties: false,
        }),
      }),
    },
    toolChoice: 'auto',
  });

  const parameters =
    requests[0]?.body?.tools?.[0]?.functionDeclarations?.[0]?.parameters;

  console.log(
    'standard tools request parameters:',
    JSON.stringify(parameters, null, 2),
  );

  if (parameters?.type !== 'object') {
    throw new Error(
      `Reproduced issue #12183: standard manual tool parameters.type was ${JSON.stringify(
        parameters?.type,
      )}, expected "object".`,
    );
  }

  if (parameters?.properties?.filePath?.type !== 'string') {
    throw new Error(
      `Reproduced issue #12183: standard manual tool filePath schema was not preserved: ${JSON.stringify(
        parameters,
      )}`,
    );
  }

  if (!parameters?.required?.includes('filePath')) {
    throw new Error(
      `Reproduced issue #12183: standard manual tool required fields were not preserved: ${JSON.stringify(
        parameters,
      )}`,
    );
  }
}

async function runLegacyProviderMetadataCheck() {
  const { vertex, requests } = createCapturingVertex();

  const tools = {
    readFile: {
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
        },
        required: ['filePath'],
        additionalProperties: false,
      },
    },
  };

  await generateText({
    model: vertex('gemini-2.5-pro'),
    system: 'Use tools when needed',
    messages: [{ role: 'user', content: 'Read package.json' }],
    toolChoice: 'auto',
    // This is the deprecated/removed v4 option from the issue report. It is
    // intentionally passed through `any` so this script can show current v5
    // runtime behavior instead of failing at TypeScript compile time.
    experimental_providerMetadata: {
      google: {
        functionCallingConfig: { mode: 'ANY' },
        tools: [
          {
            functionDeclarations: Object.entries(tools).map(([name, t]) => ({
              name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ],
      },
    },
  } as any);

  const requestTools = requests[0]?.body?.tools;
  const parameters = requestTools?.[0]?.functionDeclarations?.[0]?.parameters;

  console.log(
    'legacy experimental_providerMetadata request tools:',
    JSON.stringify(requestTools, null, 2),
  );

  if (
    parameters != null &&
    parameters.type !== 'object' &&
    JSON.stringify(parameters) === JSON.stringify({ properties: {} })
  ) {
    throw new Error(
      'Reproduced issue #12183: legacy provider metadata parameters were rewritten to {"properties":{}}.',
    );
  }
}

async function main() {
  await runStandardManualToolCheck();
  await runLegacyProviderMetadataCheck();

  console.log(
    'Could not reproduce issue #12183 in this worktree: standard manual Vertex tools preserve an OBJECT parameters schema; the legacy experimental_providerMetadata option is ignored by current v5 rather than rewritten to {"properties":{}}.',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
