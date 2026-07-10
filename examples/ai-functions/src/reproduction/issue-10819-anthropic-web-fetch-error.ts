import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

type AnthropicContentBlock = {
  type?: string;
  id?: string;
  tool_use_id?: string;
  content?: {
    type?: string;
    error_code?: string;
  };
};

type AnthropicMessage = {
  role?: string;
  content?: AnthropicContentBlock[];
};

type AnthropicRequest = {
  messages?: AnthropicMessage[];
};

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
};

type CapturedCall = {
  request?: AnthropicRequest;
  response?: AnthropicResponse;
  status?: number;
};

async function main() {
  const calls: CapturedCall[] = [];

  const anthropic = createAnthropic({
    fetch: async (input, init) => {
      const call: CapturedCall = {
        request:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as AnthropicRequest)
            : undefined,
      };
      calls.push(call);

      const response = await fetch(input, init);
      call.status = response.status;
      call.response = (await response
        .clone()
        .json()
        .catch(() => undefined)) as AnthropicResponse | undefined;

      return response;
    },
  });

  let result:
    | {
        steps: readonly unknown[];
        text: string;
      }
    | undefined;
  let generationError: unknown;

  try {
    result = await generateText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      maxOutputTokens: 512,
      temperature: 0,
      prompt: [
        'Follow these steps in order:',
        '1. Use web_fetch on https://httpbin.org/status/500.',
        '2. Wait until web_fetch has returned its result. Do not call tools in parallel.',
        '3. Regardless of whether web_fetch succeeds, call display_products once.',
        '4. After display_products returns, answer with exactly DONE.',
        'Do not skip either tool call.',
      ].join('\n'),
      tools: {
        web_fetch: anthropic.tools.webFetch_20250910({
          maxUses: 1,
        }),
        display_products: tool({
          description:
            'Record that product display was attempted after the web fetch.',
          inputSchema: z.object({}),
          execute: async () => ({ displayed: true }),
        }),
      },
      stopWhen: stepCountIs(4),
    });
  } catch (error) {
    generationError = error;
  }

  const errorResult = calls
    .flatMap(call => call.response?.content ?? [])
    .find(
      block =>
        block.type === 'web_fetch_tool_result' &&
        block.content?.type === 'web_fetch_tool_result_error',
    );

  if (errorResult?.tool_use_id == null) {
    throw new Error(
      'The live response did not exercise a web_fetch_tool_result_error, so issue #10819 could not be evaluated.',
    );
  }

  const continuationRequest = calls
    .slice(1)
    .map(call => call.request)
    .find(request =>
      request?.messages?.some(
        message =>
          message.role === 'assistant' &&
          message.content?.some(
            block =>
              block.type === 'web_fetch_tool_result' &&
              block.tool_use_id === errorResult.tool_use_id &&
              block.content?.type === 'web_fetch_tool_result_error',
          ),
      ),
    );

  const output = {
    requestCount: calls.length,
    responseStatuses: calls.map(call => call.status),
    webFetchToolUseId: errorResult.tool_use_id,
    webFetchErrorCode: errorResult.content?.error_code,
    continuationIncludedErrorResult: continuationRequest != null,
    stepCount: result?.steps.length,
    finalText: result?.text,
    generationError:
      generationError instanceof Error
        ? {
            name: generationError.name,
            message: generationError.message,
          }
        : generationError,
    requests: calls.map(call => call.request),
    responses: calls.map(call => call.response),
  };

  console.log(JSON.stringify(output, null, 2));

  if (generationError != null) {
    throw new Error(
      'Reproduced issue #10819: multi-step generation failed after the web fetch error.',
      { cause: generationError },
    );
  }

  if (continuationRequest == null) {
    throw new Error(
      'Reproduced issue #10819: the continuation request omitted the errored web_fetch_tool_result block.',
    );
  }

  if (calls.some(call => call.status != null && call.status >= 400)) {
    throw new Error(
      'Reproduced issue #10819: Anthropic rejected a multi-step continuation request after the web fetch error.',
    );
  }

  if (
    result == null ||
    result.steps.length < 2 ||
    result.text.trim() !== 'DONE'
  ) {
    throw new Error(
      'The multi-step continuation did not complete after the web fetch error.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
