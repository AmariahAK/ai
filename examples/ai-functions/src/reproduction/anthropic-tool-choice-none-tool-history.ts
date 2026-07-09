import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  LanguageModelV4Content,
  LanguageModelV4FunctionTool,
  LanguageModelV4Prompt,
} from '@ai-sdk/provider';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function textFromContent(content: LanguageModelV4Content[]): string {
  return content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('');
}

async function bodyToJson(body: BodyInit | null | undefined): Promise<unknown> {
  if (body == null) {
    return undefined;
  }

  if (typeof body === 'string') {
    return JSON.parse(body);
  }

  return JSON.parse(await new Response(body).text());
}

function redactHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  const headerEntries: Array<[string, string]> = [];

  if (headers instanceof Headers) {
    headers.forEach((value, name) => {
      headerEntries.push([name, value]);
    });
  } else if (Array.isArray(headers)) {
    headerEntries.push(...headers);
  } else {
    headerEntries.push(...Object.entries(headers ?? {}));
  }

  for (const [name, value] of headerEntries) {
    const lowerName = name.toLowerCase();
    result[lowerName] =
      lowerName === 'x-api-key' || lowerName === 'authorization'
        ? '<redacted>'
        : value;
  }

  return result;
}

async function main() {
  let capturedRequest:
    | {
        url: string;
        method: string;
        headers: Record<string, string>;
        body: unknown;
      }
    | undefined;
  let capturedResponse:
    | {
        status: number;
        body: unknown;
      }
    | undefined;

  const provider = createAnthropic({
    fetch: async (input, init) => {
      capturedRequest = {
        url: input instanceof Request ? input.url : input.toString(),
        method:
          init?.method ?? (input instanceof Request ? input.method : 'GET'),
        headers: redactHeaders(init?.headers),
        body: await bodyToJson(init?.body),
      };

      const response = await fetch(input, init);
      const responseText = await response.clone().text();

      capturedResponse = {
        status: response.status,
        body: responseText.length === 0 ? undefined : JSON.parse(responseText),
      };

      return response;
    },
  });

  const searchTool: LanguageModelV4FunctionTool = {
    type: 'function',
    name: 'search',
    description: 'Search for information.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  };

  const toolCallId = process.env.ANTHROPIC_REPRO_TOOL_CALL_ID ?? 'tc1';
  const prompt: LanguageModelV4Prompt = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Search for climate change information.' },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId,
          toolName: 'search',
          input: { query: 'climate change' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: 'search',
          output: {
            type: 'text',
            value:
              'Climate change is driven by greenhouse gases and affects temperatures, weather patterns, and sea levels.',
          },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Now summarize what you found in one short sentence.',
        },
      ],
    },
  ];
  const modelId = process.env.ANTHROPIC_REPRO_MODEL ?? 'claude-sonnet-4-6';
  const model = provider(modelId);

  const result = await model.doGenerate({
    prompt,
    tools: [searchTool],
    toolChoice: { type: 'none' },
    maxOutputTokens: 128,
  });

  const text = textFromContent(result.content);
  const fixturePath = resolve(
    process.cwd(),
    '../../packages/anthropic/src/__fixtures__/anthropic-tool-choice-none-live-response.json',
  );

  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(
    fixturePath,
    `${JSON.stringify(
      {
        request: capturedRequest,
        response: capturedResponse,
        result: {
          content: result.content,
          finishReason: result.finishReason,
          usage: result.usage,
          warnings: result.warnings,
        },
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify(
      {
        requestHasTools:
          capturedRequest != null &&
          typeof capturedRequest.body === 'object' &&
          capturedRequest.body != null &&
          'tools' in capturedRequest.body,
        requestHasToolChoice:
          capturedRequest != null &&
          typeof capturedRequest.body === 'object' &&
          capturedRequest.body != null &&
          'tool_choice' in capturedRequest.body,
        responseStatus: capturedResponse?.status,
        modelId,
        content: result.content,
        text,
        finishReason: result.finishReason,
        fixturePath,
      },
      null,
      2,
    ),
  );

  if (text.length === 0) {
    throw new Error(
      "Reproduced issue #12378: Anthropic returned empty text after tool_use/tool_result history when toolChoice is 'none'.",
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
