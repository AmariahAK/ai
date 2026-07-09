import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  LanguageModelV4Content,
  LanguageModelV4Prompt,
} from '@ai-sdk/provider';

const promptWithToolHistory: LanguageModelV4Prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Search for climate change' }],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'toolu_01_issue12378',
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
        toolCallId: 'toolu_01_issue12378',
        toolName: 'search',
        output: {
          type: 'text',
          value:
            'Climate change is a long-term shift in temperatures and weather patterns.',
        },
      },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Now summarize what you found in one sentence.' },
    ],
  },
];

function getText(content: LanguageModelV4Content[]) {
  return content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('');
}

function hasProperty(value: unknown, property: string) {
  return (
    value != null &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, property)
  );
}

async function main() {
  const captured: {
    requestBody?: unknown;
    responseStatus?: number;
    responseBodyText?: string;
  } = {};

  const anthropic = createAnthropic({
    fetch: async (input, init) => {
      captured.requestBody =
        typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;

      const response = await fetch(input, init);
      captured.responseStatus = response.status;
      captured.responseBodyText = await response.clone().text();
      return response;
    },
  });

  const result = await anthropic('claude-sonnet-4-6').doGenerate({
    prompt: promptWithToolHistory,
    maxOutputTokens: 64,
    tools: [
      {
        type: 'function',
        name: 'search',
        description: 'Search for information',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
    toolChoice: { type: 'none' },
  });

  const requestHasTools = hasProperty(captured.requestBody, 'tools');
  const requestHasToolChoice = hasProperty(captured.requestBody, 'tool_choice');

  console.log(
    JSON.stringify(
      {
        requestHasTools,
        requestHasToolChoice,
        responseStatus: captured.responseStatus,
        text: getText(result.content),
        finishReason: result.finishReason,
      },
      null,
      2,
    ),
  );

  if (!requestHasTools || !requestHasToolChoice) {
    throw new Error(
      'Reproduced issue #12378: toolChoice none removed tools/tool_choice from the Anthropic request.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
