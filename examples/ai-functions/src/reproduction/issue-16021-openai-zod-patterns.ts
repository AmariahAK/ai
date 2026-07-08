import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import {
  APICallError,
  type ModelMessage,
  streamText,
  tool,
  type ToolSet,
} from 'ai';
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod/v4';

type Capture = {
  requestBody?: unknown;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  chunks: string[];
  responseText?: string;
  done?: Promise<void>;
};

const fixtureBasePath = resolve(
  process.cwd(),
  '../../packages/openai/src/responses/__fixtures__/issue-16021-openai-zod-patterns-live',
);

async function main() {
  const capture: Capture = { chunks: [] };
  const model = createCapturedOpenAIModel(capture);
  const tools = createTools();

  const result = streamText({
    model,
    system: createSystemPrompt(),
    messages: createMessages(),
    tools,
    maxOutputTokens: 32,
    maxRetries: 0,
    include: { rawChunks: true },
    providerOptions: {
      openai: {
        reasoningEffort: 'none',
      },
    },
  });

  const observedErrors: unknown[] = [];
  const observedParts: Array<{
    type: string;
    text?: string;
    error?: string;
    rawType?: string;
  }> = [];

  try {
    for await (const part of result.stream) {
      if (part.type === 'raw') {
        observedParts.push({
          type: part.type,
          rawType: getRawType(part.rawValue),
        });
        continue;
      }

      if (part.type === 'text-delta') {
        observedParts.push({ type: part.type, text: part.text });
        process.stdout.write(part.text);
        continue;
      }

      if (part.type === 'error') {
        observedErrors.push(part.error);
        observedParts.push({
          type: part.type,
          error: formatError(part.error),
        });
        continue;
      }

      observedParts.push({ type: part.type });
    }
  } catch (error) {
    observedErrors.push(error);
  } finally {
    await capture.done?.catch(() => undefined);
    await writeCaptureFixture(capture, observedParts);
  }

  const patternCount = countKeyword(capture.requestBody, 'pattern');
  const formatCount = countKeyword(capture.requestBody, 'format');

  console.log('\n\nissue-16021 live reproduction summary');
  console.log(`responseStatus=${capture.responseStatus ?? 'none'}`);
  console.log(`requestPatternKeywordCount=${patternCount}`);
  console.log(`requestFormatKeywordCount=${formatCount}`);
  console.log(`capturedChunkCount=${capture.chunks.length}`);
  console.log(`fixtureBasePath=${fixtureBasePath}`);

  if (patternCount === 0) {
    throw new Error(
      'The request did not contain any JSON Schema pattern keywords; reproduction setup is invalid.',
    );
  }

  if (observedErrors.length > 0) {
    const formattedErrors = observedErrors.map(formatError).join('\n---\n');
    if (formattedErrors.includes('server_error')) {
      throw new Error(
        `Reproduced issue #16021: OpenAI stream failed with server_error.\n${formattedErrors}`,
      );
    }

    throw new Error(
      `Stream failed with a non-server_error:\n${formattedErrors}`,
    );
  }

  if (capture.responseStatus != null && capture.responseStatus >= 400) {
    throw new Error(
      `HTTP request failed with status ${capture.responseStatus} without a stream error part.`,
    );
  }

  console.log(
    'No in-stream server_error was observed for this shareable body.',
  );
}

function createCapturedOpenAIModel(capture: Capture): LanguageModelV4 {
  const openai = createOpenAI({
    fetch: async (url, init) => {
      capture.requestBody =
        typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;

      const response = await fetch(url, init);
      capture.responseStatus = response.status;
      capture.responseHeaders = headersToRecord(response.headers);

      if (response.body == null) {
        capture.responseText = await response.clone().text();
        return response;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        capture.responseText = await response.clone().text();
        return response;
      }

      const [sdkStream, captureStream] = response.body.tee();
      capture.done = readEventStream(captureStream, capture);

      return new Response(sdkStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });

  return openai('gpt-5.4');
}

function headersToRecord(headers: Headers): Record<string, string> {
  const safeHeaders = new Set([
    'content-type',
    'date',
    'openai-processing-ms',
    'openai-version',
    'x-request-id',
  ]);
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (safeHeaders.has(key)) {
      record[key] = value;
    }
  });
  return record;
}

async function readEventStream(
  stream: ReadableStream<Uint8Array>,
  capture: Capture,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      capture.chunks.push(decoder.decode(value, { stream: true }));
    }

    const remainder = decoder.decode();
    if (remainder.length > 0) {
      capture.chunks.push(remainder);
    }
  } finally {
    reader.releaseLock();
  }
}

async function writeCaptureFixture(
  capture: Capture,
  observedParts: Array<{
    type: string;
    text?: string;
    error?: string;
    rawType?: string;
  }>,
) {
  await mkdir(resolve(fixtureBasePath, '..'), { recursive: true });

  await writeFile(
    `${fixtureBasePath}.json`,
    `${JSON.stringify(
      {
        requestBody: capture.requestBody,
        responseStatus: capture.responseStatus,
        responseHeaders: capture.responseHeaders,
        responseText: capture.responseText,
        observedParts,
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(`${fixtureBasePath}.chunks.txt`, capture.chunks.join(''));
}

function createTools(): ToolSet {
  const tools: ToolSet = {};

  for (let index = 1; index <= 12; index++) {
    tools[`collectProfile${index}`] = tool({
      description:
        `Collect and normalize profile ${index}. ` +
        'The fields intentionally use zod v4 string-format validators that emit JSON Schema pattern keywords.',
      inputSchema: z.object({
        email: z
          .email()
          .describe('A deliverable contact email address for the profile.'),
        kidId: z
          .uuid()
          .describe('A stable UUID for the child or dependent profile.'),
        birthDate: z.iso.date().describe('An ISO calendar date of birth.'),
        guardianEmail: z
          .email()
          .describe('A backup email address for the guardian.'),
        householdId: z.uuid().describe('A stable UUID for the household.'),
        note: z
          .string()
          .min(1)
          .max(200)
          .describe('A short plain-English note about the profile.'),
      }),
    });
  }

  return tools;
}

function createMessages(): ModelMessage[] {
  return [
    {
      role: 'user',
      content:
        'Earlier turn: please prepare the intake workflow and remember that the final answer should be concise.',
    },
    {
      role: 'assistant',
      content:
        'Earlier turn acknowledged. I can answer readiness checks without calling tools.',
    },
    {
      role: 'user',
      content:
        'Second earlier turn: the schemas include email, UUID, and ISO-date constraints.',
    },
    {
      role: 'assistant',
      content:
        'Second earlier turn acknowledged. I will avoid tools unless they are required.',
    },
    {
      role: 'user',
      content: 'Readiness check only. Reply with exactly READY.',
    },
  ];
}

function createSystemPrompt(): string {
  const policyParagraph = [
    'You are validating an internal intake workflow.',
    'Prefer a short natural-language answer and do not call tools unless absolutely required.',
    'The available tools are intentionally verbose because this reproduction targets provider-side schema handling.',
    'If the user asks for a direct readiness check, answer with exactly READY.',
  ].join(' ');

  const repeatedPolicy = Array.from(
    { length: 55 },
    (_, index) => `${index + 1}. ${policyParagraph}`,
  ).join('\n');

  return `System policy for the reproduction:\n${repeatedPolicy}`;
}

function countKeyword(value: unknown, keyword: string): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countKeyword(item, keyword), 0);
  }

  if (value == null || typeof value !== 'object') {
    return 0;
  }

  return Object.entries(value).reduce(
    (sum, [key, nestedValue]) =>
      sum + (key === keyword ? 1 : 0) + countKeyword(nestedValue, keyword),
    0,
  );
}

function getRawType(rawValue: unknown): string | undefined {
  return rawValue != null &&
    typeof rawValue === 'object' &&
    'type' in rawValue &&
    typeof rawValue.type === 'string'
    ? rawValue.type
    : undefined;
}

function formatError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    return JSON.stringify(
      {
        name: error.name,
        message: error.message,
        statusCode: error.statusCode,
        responseBody: error.responseBody,
        requestBodyValues: error.requestBodyValues,
      },
      null,
      2,
    );
  }

  if (error instanceof Error) {
    return JSON.stringify(
      {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      null,
      2,
    );
  }

  return JSON.stringify(error, null, 2);
}

main().catch(error => {
  console.error(formatError(error));
  process.exitCode = 1;
});
