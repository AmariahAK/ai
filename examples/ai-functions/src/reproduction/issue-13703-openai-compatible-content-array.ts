import fs from 'node:fs';
import type {
  LanguageModelV4Content,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const fixtureDirectory = new URL(
  '../../../../packages/openai-compatible/src/chat/__fixtures__/',
  import.meta.url,
);

const generateFixture = fs.readFileSync(
  new URL('issue-13703-mistral-thinking.json', fixtureDirectory),
  'utf8',
);
const streamFixture = fs
  .readFileSync(
    new URL('issue-13703-mistral-thinking.chunks.txt', fixtureDirectory),
    'utf8',
  )
  .trim()
  .split('\n')
  .map(line => `data: ${line}\n\n`)
  .concat('data: [DONE]\n\n')
  .join('');

const prompt: LanguageModelV4Prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'What is 17 * 23?' }],
  },
];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const provider = createOpenAICompatible({
    baseURL: 'https://api.mistral.ai/v1',
    name: 'mistral',
    fetch: async (_input, init) => {
      const requestBody =
        typeof init?.body === 'string' ? JSON.parse(init.body) : {};

      return requestBody.stream
        ? new Response(streamFixture, {
            headers: { 'content-type': 'text/event-stream' },
          })
        : new Response(generateFixture, {
            headers: { 'content-type': 'application/json' },
          });
    },
  });
  const model = provider('mistral-small-latest');

  let generateContent: LanguageModelV4Content[] | undefined;
  let generateError: string | undefined;
  try {
    generateContent = (await model.doGenerate({ prompt })).content;
  } catch (error) {
    generateError = getErrorMessage(error);
  }

  let streamEvents: LanguageModelV4StreamPart[] = [];
  let streamError: string | undefined;
  try {
    const { stream } = await model.doStream({ prompt });
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      streamEvents.push(value);
    }
  } catch (error) {
    streamError = getErrorMessage(error);
  }

  const streamValidationErrors = streamEvents
    .filter(event => event.type === 'error')
    .map(event => getErrorMessage(event.error));
  const reasoningDeltas = streamEvents
    .filter(event => event.type === 'reasoning-delta')
    .map(event => event.delta);
  const textDeltas = streamEvents
    .filter(event => event.type === 'text-delta')
    .map(event => event.delta);

  console.log(
    JSON.stringify(
      {
        generateContent,
        generateError,
        streamError,
        streamValidationErrors,
        reasoningDeltas,
        textDeltas,
      },
      null,
      2,
    ),
  );

  const failures: string[] = [];

  if (generateError != null) {
    failures.push(`doGenerate failed: ${generateError}`);
  } else {
    const reasoning = generateContent?.find(part => part.type === 'reasoning');
    const text = generateContent?.find(part => part.type === 'text');
    if (
      reasoning?.text.includes('17 multiplied by 23') !== true ||
      text?.text !== '391'
    ) {
      failures.push(
        'doGenerate did not normalize the thinking and text content parts.',
      );
    }
  }

  if (streamError != null) {
    failures.push(`doStream failed: ${streamError}`);
  }
  if (streamValidationErrors.length > 0) {
    failures.push(
      `doStream emitted ${streamValidationErrors.length} validation error event(s).`,
    );
  }
  if (
    reasoningDeltas.join('') !== 'The user is asking a' ||
    textDeltas.join('') !== '4'
  ) {
    failures.push(
      'doStream did not normalize the thinking and text content parts.',
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `Reproduced issue #13703:\n${failures
        .map(failure => `- ${failure}`)
        .join('\n')}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
