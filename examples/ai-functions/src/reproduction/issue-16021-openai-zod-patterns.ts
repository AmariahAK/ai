import 'dotenv/config';
import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';

const fixtureBasePath =
  '../../packages/openai/src/responses/__fixtures__/issue-16021-openai-zod-patterns-live';

const schemaToolNames = [
  'createPatient',
  'updateGuardian',
  'scheduleVisit',
  'registerKid',
  'lookupEnrollment',
  'inviteCaregiver',
  'confirmInsurance',
  'recordConsent',
  'syncSchoolProfile',
  'createEmergencyContact',
  'updateHousehold',
  'sendPortalMessage',
] as const;

function makePatternHeavySchema(index: number) {
  return z.object({
    childEmail: z.email().describe(`Email address for child profile ${index}`),
    guardianEmail: z
      .email()
      .describe(`Guardian email address for profile ${index}`),
    kidId: z.uuid().describe(`Child UUID for profile ${index}`),
    householdId: z.uuid().describe(`Household UUID for profile ${index}`),
    birthDate: z.iso.date().describe(`Birth date for profile ${index}`),
    enrollmentDate: z.iso
      .date()
      .describe(`Program enrollment date for profile ${index}`),
    notes: z
      .string()
      .describe(
        `Short non-sensitive routing note for a pediatric admin workflow ${index}`,
      ),
  });
}

const tools = Object.fromEntries(
  schemaToolNames.map((name, index) => [
    name,
    tool({
      description: [
        `Synthetic issue #16021 tool ${index + 1}.`,
        'The schema intentionally uses zod/v4 string-format validators',
        'that emit JSON Schema pattern and format keywords.',
        'Do not call this tool unless explicitly asked.',
      ].join(' '),
      inputSchema: makePatternHeavySchema(index + 1),
    }),
  ]),
);

const system = Array.from(
  { length: 72 },
  (_, index) =>
    `Policy paragraph ${index + 1}: You are an administrative assistant for a synthetic pediatric portal. Prefer concise direct answers. Never call tools unless the user explicitly requests an external workflow. Validate dates, email addresses, and UUID-like identifiers only when tool execution is requested. For this reproduction, the final user asks for a readiness marker, so answer with READY and do not invoke any tool.`,
).join('\n');

const messages = [
  {
    role: 'user' as const,
    content:
      'We are reviewing a long pediatric portal thread with many administrative actions available. Please remember that no real patient data is included.',
  },
  {
    role: 'assistant' as const,
    content:
      'Understood. I will keep the response concise and avoid calling administrative tools unless explicitly asked.',
  },
  {
    role: 'user' as const,
    content:
      'The tool catalog contains email, UUID, and ISO date fields because the production issue involved zod/v4 string-format schemas.',
  },
  {
    role: 'assistant' as const,
    content:
      'Understood. Those schemas can be present without requiring a tool call for a simple readiness check.',
  },
  {
    role: 'user' as const,
    content:
      'Reply exactly READY. Do not call any tool. Do not add punctuation or explanation.',
  },
];

function sanitizeHeaders(headers: Headers) {
  const output: Record<string, string> = {};

  headers.forEach((value, key) => {
    output[key] = [
      'authorization',
      'cookie',
      'openai-organization',
      'openai-project',
      'set-cookie',
      'x-api-key',
    ].includes(key.toLowerCase())
      ? '<redacted>'
      : value;
  });

  return output;
}

function countKeyDeep(value: unknown, keyToCount: string): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countKeyDeep(item, keyToCount), 0);
  }

  if (value == null || typeof value !== 'object') {
    return 0;
  }

  return Object.entries(value).reduce(
    (sum, [key, nestedValue]) =>
      sum +
      (key === keyToCount ? 1 : 0) +
      countKeyDeep(nestedValue, keyToCount),
    0,
  );
}

function readRequestBody(body: unknown) {
  if (typeof body !== 'string') {
    return undefined;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function readStream(stream: ReadableStream<Uint8Array> | null) {
  if (stream == null) {
    return '';
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    result += decoder.decode(value, { stream: true });
  }

  result += decoder.decode();

  return result;
}

function extractSseEvents(rawChunks: string) {
  return rawChunks
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice('data: '.length))
    .filter(line => line !== '[DONE]')
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
}

function findServerError(events: Array<unknown>) {
  return events.find(
    event =>
      event != null &&
      typeof event === 'object' &&
      'type' in event &&
      event.type === 'error' &&
      'error' in event &&
      event.error != null &&
      typeof event.error === 'object' &&
      'type' in event.error &&
      event.error.type === 'server_error',
  );
}

async function main() {
  let requestBody: unknown;
  let requestHeaders: Record<string, string> | undefined;
  let responseMetadata:
    | {
        status: number;
        statusText: string;
        headers: Record<string, string>;
      }
    | undefined;
  let capturedRawChunks = '';
  let capturePromise: Promise<void> | undefined;

  const openai = createOpenAI({
    fetch: async (input, init) => {
      requestBody = readRequestBody(init?.body);
      requestHeaders = sanitizeHeaders(new Headers(init?.headers));

      const response = await fetch(input, init);
      responseMetadata = {
        status: response.status,
        statusText: response.statusText,
        headers: sanitizeHeaders(response.headers),
      };

      if (response.body == null) {
        return response;
      }

      const [sdkStream, captureStream] = response.body.tee();
      capturePromise = readStream(captureStream).then(rawChunks => {
        capturedRawChunks = rawChunks;
      });

      return new Response(sdkStream, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    },
  });

  const result = streamText({
    model: openai.responses('gpt-5.4'),
    system,
    messages,
    tools,
    maxOutputTokens: 32,
    providerOptions: {
      openai: {
        parallelToolCalls: false,
        reasoningEffort: 'none',
      } satisfies OpenAILanguageModelResponsesOptions,
    },
    includeRawChunks: true,
  });

  const processedChunks: Array<unknown> = [];
  let text = '';

  for await (const chunk of result.fullStream) {
    processedChunks.push(chunk);

    if (chunk.type === 'text-delta') {
      text += chunk.text;
    }

    if (chunk.type === 'error') {
      console.error('AI SDK stream error chunk:', chunk.error);
    }
  }

  await capturePromise;

  const sseEvents = extractSseEvents(capturedRawChunks);
  const serverError = findServerError(sseEvents);
  const requestPatternCount = countKeyDeep(requestBody, 'pattern');
  const requestFormatCount = countKeyDeep(requestBody, 'format');
  const fixtureDirectory = path.dirname(fixtureBasePath);

  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(
    `${fixtureBasePath}.chunks.txt`,
    sseEvents
      .map(event => (typeof event === 'string' ? event : JSON.stringify(event)))
      .join('\n'),
  );
  await writeFile(
    `${fixtureBasePath}.json`,
    `${JSON.stringify(
      {
        issue: 16021,
        model: 'gpt-5.4',
        observedAt: new Date().toISOString(),
        request: {
          url: 'https://api.openai.com/v1/responses',
          headers: requestHeaders,
          body: requestBody,
          patternCount: requestPatternCount,
          formatCount: requestFormatCount,
        },
        response: {
          ...responseMetadata,
          serverError,
          eventTypes: sseEvents.map(event =>
            event != null && typeof event === 'object' && 'type' in event
              ? event.type
              : typeof event,
          ),
          text,
        },
        processedChunkTypes: processedChunks.map(chunk =>
          chunk != null && typeof chunk === 'object' && 'type' in chunk
            ? chunk.type
            : typeof chunk,
        ),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Request pattern keywords: ${requestPatternCount}`);
  console.log(`Request format keywords: ${requestFormatCount}`);
  console.log(`Response status: ${responseMetadata?.status}`);
  console.log(
    `SSE event types: ${sseEvents
      .map(event =>
        event != null && typeof event === 'object' && 'type' in event
          ? event.type
          : typeof event,
      )
      .join(', ')}`,
  );
  console.log(`Final text: ${JSON.stringify(text)}`);
  console.log(`Wrote ${fixtureBasePath}.json`);
  console.log(`Wrote ${fixtureBasePath}.chunks.txt`);

  if (serverError == null) {
    console.log(
      'Issue #16021 not reproduced: no in-stream OpenAI server_error was observed.',
    );
    return;
  }

  console.error(
    'Issue #16021 reproduced: OpenAI returned an in-stream server_error.',
  );
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
