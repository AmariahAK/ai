import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const prompt: LanguageModelV4Prompt = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Think step by step, then answer: What is 17 * 23?',
      },
    ],
  },
];

function hasContentArray(value: unknown): boolean {
  if (value == null || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasContentArray);
  }

  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.content) || Object.values(record).some(hasContentArray)
  );
}

async function main() {
  let generateResponse: unknown;
  let streamResponseText: Promise<string> | undefined;

  const provider = createOpenAICompatible({
    baseURL: 'https://api.mistral.ai/v1',
    name: 'mistral',
    apiKey: process.env.MISTRAL_API_KEY,
    fetch: async (input, init) => {
      const requestBody =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as { stream?: boolean })
          : {};
      const response = await fetch(input, init);

      if (requestBody.stream) {
        streamResponseText = response.clone().text();
      } else {
        generateResponse = await response.clone().json();
      }

      return response;
    },
  });
  const model = provider('mistral-small-latest');

  const generateResult = await model.doGenerate({
    prompt,
    reasoning: 'high',
  });

  const { stream } = await model.doStream({
    prompt,
    reasoning: 'high',
  });
  const streamEvents = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    streamEvents.push(value);
  }

  const streamChunks = (await streamResponseText)
    ?.split('\n')
    .filter(line => line.startsWith('data: {'))
    .map(line => JSON.parse(line.slice(6)));

  const generateContent = generateResult.content;
  const observedGenerateContentArray = hasContentArray(generateResponse);
  const observedStreamContentArray =
    streamChunks?.some(hasContentArray) === true;
  const reasoningDeltas = streamEvents
    .filter(event => event.type === 'reasoning-delta')
    .map(event => event.delta);
  const textDeltas = streamEvents
    .filter(event => event.type === 'text-delta')
    .map(event => event.delta);

  console.log(
    JSON.stringify(
      {
        generateContentTypes: generateContent.map(part => part.type),
        observedGenerateContentArray,
        observedStreamContentArray,
        streamReasoningLength: reasoningDeltas.join('').length,
        streamTextLength: textDeltas.join('').length,
      },
      null,
      2,
    ),
  );

  if (!observedGenerateContentArray || !observedStreamContentArray) {
    throw new Error(
      'The live Mistral responses did not include array-based content, so the reproduction could not be validated.',
    );
  }

  if (
    !generateContent.some(
      part => part.type === 'reasoning' && part.text.length > 0,
    ) ||
    !generateContent.some(part => part.type === 'text' && part.text.length > 0)
  ) {
    throw new Error(
      'doGenerate did not normalize the live thinking and text content parts.',
    );
  }

  if (
    reasoningDeltas.join('').length === 0 ||
    textDeltas.join('').length === 0
  ) {
    throw new Error(
      'doStream did not normalize the live thinking and text content parts.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
