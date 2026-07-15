import { createOpenAI } from '@ai-sdk/openai';
import { generateText, type ModelMessage } from 'ai';

async function main() {
  let responsesApiBody: unknown;
  let chatCompletionsApiBody: unknown;
  const openai = createOpenAI({
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const responseBody = await response
        .clone()
        .json()
        .catch(() => undefined);

      if (String(input).endsWith('/responses')) {
        responsesApiBody = responseBody;
      } else if (String(input).endsWith('/chat/completions')) {
        chatCompletionsApiBody = responseBody;
      }

      return response;
    },
  });

  const prompt =
    'Use web search to find the current title of the OpenAI API documentation homepage.';

  const firstTurn = await generateText({
    model: openai.responses('gpt-4o-mini'),
    prompt,
    tools: {
      web_search_preview: openai.tools.webSearchPreview({}),
    },
  });

  const webSearchCall = firstTurn.toolCalls.find(
    toolCall => toolCall.toolName === 'web_search_preview',
  );

  if (webSearchCall == null) {
    throw new Error(
      'The live Responses API call did not produce a web_search_preview tool call.',
    );
  }

  const responseMessage = firstTurn.response.messages[0];
  if (responseMessage?.role !== 'assistant') {
    throw new Error(
      'Expected the first Responses API message to be assistant.',
    );
  }
  if (!Array.isArray(responseMessage.content)) {
    throw new Error(
      'Expected the Responses API assistant content to be parts.',
    );
  }

  const assistantContent = responseMessage.content.filter(
    part => part.type !== 'tool-result',
  );
  const toolContent = responseMessage.content.filter(
    part => part.type === 'tool-result',
  );
  const reportedToolCallId =
    'ws_689e2d4880a0819d98acca37694989b00b15d90494fc6b87';

  const messages: ModelMessage[] = [
    { role: 'user', content: prompt },
    {
      role: 'assistant',
      content: assistantContent.map(part =>
        part.type === 'tool-call'
          ? { ...part, toolCallId: reportedToolCallId }
          : part,
      ),
    },
    {
      role: 'tool',
      content: toolContent.map(part => ({
        ...part,
        toolCallId: reportedToolCallId,
      })),
    },
    {
      role: 'user',
      content: 'Reply with only that title.',
    },
  ];

  const secondTurn = await generateText({
    model: openai.chat('gpt-4o-mini'),
    messages,
  });

  if (secondTurn.text.length === 0) {
    throw new Error(
      'The Chat Completions request accepted the ID but returned no text.',
    );
  }

  console.log(
    JSON.stringify(
      {
        generatedToolCallId: webSearchCall.toolCallId,
        generatedToolCallIdLength: webSearchCall.toolCallId.length,
        reportedToolCallId,
        reportedToolCallIdLength: reportedToolCallId.length,
        responsesApiBody,
        chatCompletionsApiBody,
        responseText: secondTurn.text,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
