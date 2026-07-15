import { openai } from '@ai-sdk/openai';
import { generateText, type ModelMessage } from 'ai';
import 'dotenv/config';

const reportedToolCallId =
  'ws_689e2d4880a0819d98acca37694989b00b15d90494fc6b87';

function findWebSearchToolCallId(messages: ModelMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content === 'string') {
      continue;
    }

    for (const part of message.content) {
      if (part.type === 'tool-call' && part.toolName === 'web_search_preview') {
        return part.toolCallId;
      }
    }
  }

  throw new Error('The Responses API did not return a web search tool call.');
}

async function main() {
  const searchResult = await generateText({
    model: openai.responses('gpt-4o-mini'),
    prompt:
      'Use web search to find the title of the official OpenAI API documentation page.',
    tools: {
      web_search_preview: openai.tools.webSearchPreview({
        searchContextSize: 'low',
      }),
    },
    toolChoice: {
      type: 'tool',
      toolName: 'web_search_preview',
    },
    maxRetries: 0,
  });

  const webSearchToolCallId = findWebSearchToolCallId(
    searchResult.response.messages,
  );

  console.log(
    JSON.stringify(
      {
        responsesApi: {
          toolCallId: webSearchToolCallId,
          toolCallIdLength: webSearchToolCallId.length,
          body: searchResult.response.body,
        },
      },
      null,
      2,
    ),
  );

  if (webSearchToolCallId.length <= 40) {
    throw new Error(
      `Expected OpenAI to generate a web search tool-call ID longer than 40 characters, but got ${webSearchToolCallId.length}.`,
    );
  }

  const webSearchToolResult = searchResult.toolResults.find(
    result => result.toolCallId === webSearchToolCallId,
  );

  if (webSearchToolResult == null) {
    throw new Error('The Responses API did not return a web search result.');
  }

  const followUpResult = await generateText({
    model: openai.chat('gpt-4o-mini'),
    messages: [
      {
        role: 'user',
        content:
          'Use web search to find the title of the official OpenAI API documentation page.',
      },
      ...searchResult.response.messages,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: webSearchToolCallId,
            toolName: 'web_search_preview',
            output: {
              type: 'json',
              value: webSearchToolResult.output,
            },
          },
        ],
      },
      {
        role: 'user',
        content: 'Reply with only the documentation page title.',
      },
    ],
    maxRetries: 0,
  });

  const reportedIdFollowUpResult = await generateText({
    model: openai.chat('gpt-4o-mini'),
    messages: [
      {
        role: 'user',
        content:
          'Use web search to find the title of the official OpenAI API documentation page.',
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: reportedToolCallId,
            toolName: 'web_search_preview',
            input: {},
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: reportedToolCallId,
            toolName: 'web_search_preview',
            output: {
              type: 'json',
              value: {
                action: {
                  type: 'search',
                  query: 'official OpenAI API documentation page title',
                },
              },
            },
          },
        ],
      },
      {
        role: 'user',
        content: 'Reply with only the documentation page title.',
      },
    ],
    maxRetries: 0,
  });

  console.log(
    JSON.stringify(
      {
        generatedIdChatCompletionsApi: {
          text: followUpResult.text,
          body: followUpResult.response.body,
        },
        reportedIdChatCompletionsApi: {
          toolCallId: reportedToolCallId,
          toolCallIdLength: reportedToolCallId.length,
          text: reportedIdFollowUpResult.text,
          body: reportedIdFollowUpResult.response.body,
        },
        reportedToolCallIdLength: reportedToolCallId.length,
        expectedIssueBehavior:
          'Chat Completions rejects messages[*].tool_calls[*].id longer than 40 characters.',
        observedBehavior:
          'Chat Completions accepted the long web-search tool-call ID and returned a text response.',
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
