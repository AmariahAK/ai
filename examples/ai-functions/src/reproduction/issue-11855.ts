import { createAnthropic } from '@ai-sdk/anthropic';
import { APICallError, generateText, tool } from 'ai';
import { z } from 'zod';

async function main() {
  console.log(
    'Issue 11855: sending an Anthropic follow-up conversation that contains a client tool call, a provider-executed code_execution tool call with an error result in the assistant message, and the client tool result in the next tool message.',
  );

  let requestBody: any;
  const anthropic = createAnthropic({
    fetch: async (input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return fetch(input, init);
    },
  });

  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-5'),
      maxOutputTokens: 32,
      tools: {
        web_scraper: tool({
          inputSchema: z.object({
            url: z.string(),
          }),
          execute: async () => 'not used by this reproduction',
        }),
        code_execution: anthropic.tools.codeExecution_20250825(),
      },
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Prepare the brief.' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'I will inspect the website and run code.',
            },
            {
              type: 'tool-call',
              toolCallId: 'toolu_issue11855_web_scraper',
              toolName: 'web_scraper',
              input: { url: 'https://example.com' },
              providerOptions: {
                anthropic: {
                  caller: { type: 'direct' },
                },
              },
            },
            {
              type: 'tool-call',
              toolCallId: 'srvtoolu_issue11855_code_execution',
              toolName: 'code_execution',
              input: {
                type: 'programmatic-tool-call',
                code: 'print("hello")',
              },
              providerExecuted: true,
            },
            {
              type: 'tool-result',
              toolCallId: 'srvtoolu_issue11855_code_execution',
              toolName: 'code_execution',
              output: {
                type: 'error-json',
                value: JSON.stringify({
                  type: 'code_execution_tool_result_error',
                  errorCode: 'unavailable',
                }),
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'toolu_issue11855_web_scraper',
              toolName: 'web_scraper',
              output: {
                type: 'text',
                value: 'Example Domain page contents.',
              },
            },
          ],
        },
      ] as any,
    });

    console.log('Anthropic request completed.');
    console.log(
      'Converted assistant content order:',
      requestBody.messages[1].content.map((part: { type: string }) => part.type),
    );
    console.log('Result text:', result.text);
  } catch (error) {
    console.error('Anthropic request failed.');
    console.error(error);

    if (APICallError.isInstance(error)) {
      console.error('Status code:', error.statusCode);
      console.error('Response body:', error.responseBody);
      console.error('Request body:', error.requestBodyValues);
    }

    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
