import { createXai } from '@ai-sdk/xai';
import { streamText } from 'ai';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const modelId = 'grok-4-1-fast-non-reasoning';
const marker = 'END_OK_9981';
const fixturePath = resolve(
  process.cwd(),
  '../../packages/xai/src/responses/__fixtures__/issue-13836-xai-responses-missing-tail.chunks.txt',
);

const prompt = `Return only the requested content, with no introduction or conclusion.

1. Write a numbered list from 1 to 120.
2. Each line must be: \`<N>. alfa beta gama delta epsilon zeta eta theta iota kappa lambda mu\`
3. Then write a JavaScript code block with 80 numbered comment lines: \`// 1\` through \`// 80\`
4. End with the exact line: \`${marker}\``;

type XaiEvent = {
  type?: string;
  delta?: string;
  item?: {
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  response?: {
    model?: string;
  };
};

function extractEvents(sse: string): XaiEvent[] {
  return sse
    .split(/\r?\n\r?\n/)
    .flatMap(block =>
      block
        .split(/\r?\n/)
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice('data: '.length)),
    )
    .filter(data => data !== '[DONE]')
    .map(data => JSON.parse(data) as XaiEvent);
}

function getCompletedMessage(events: XaiEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (
      event?.type === 'response.output_item.done' &&
      event.item?.type === 'message'
    ) {
      return event.item.content
        ?.filter(content => content.type === 'output_text')
        .map(content => content.text ?? '')
        .join('');
    }
  }
}

async function runOnce(runNumber: number) {
  let responseBodyPromise: Promise<string> | undefined;
  let requestBody: { model?: string; stream?: boolean } | undefined;

  const xai = createXai({
    fetch: async (input, init) => {
      if (typeof init?.body === 'string') {
        requestBody = JSON.parse(init.body);
      }

      const response = await fetch(input, init);
      if (response.body == null) {
        return response;
      }

      const [sdkBody, fixtureBody] = response.body.tee();
      responseBodyPromise = new Response(fixtureBody).text();

      return new Response(sdkBody, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    },
  });

  const result = streamText({
    model: xai.responses(modelId),
    maxOutputTokens: 5000,
    prompt,
  });

  let streamedText = '';
  for await (const textDelta of result.textStream) {
    streamedText += textDelta;
  }

  const finishReason = await result.finishReason;
  const responseBody = await responseBodyPromise;
  if (responseBody == null) {
    throw new Error('The xAI response body was not captured.');
  }

  const events = extractEvents(responseBody);
  const completedText = getCompletedMessage(events);
  if (completedText == null) {
    throw new Error(
      'The live xAI stream did not contain a completed message item.',
    );
  }

  const deltaText = events
    .filter(event => event.type === 'response.output_text.delta')
    .map(event => event.delta ?? '')
    .join('');
  const providerModel = events.find(event => event.type === 'response.created')
    ?.response?.model;

  if (runNumber === 1) {
    await mkdir(resolve(fixturePath, '..'), { recursive: true });
    await writeFile(
      fixturePath,
      `${events.map(event => JSON.stringify(event)).join('\n')}\n`,
    );
  }

  const summary = {
    run: runNumber,
    requestedModel: requestBody?.model,
    providerModel,
    responsesPath: requestBody?.stream === true,
    finishReason,
    eventCount: events.length,
    textDeltaEventCount: events.filter(
      event => event.type === 'response.output_text.delta',
    ).length,
    streamedLength: streamedText.length,
    deltaLength: deltaText.length,
    completedLength: completedText.length,
    streamedHasMarker: streamedText.trimEnd().endsWith(marker),
    completedHasMarker: completedText.trimEnd().endsWith(marker),
    streamedMatchesDeltas: streamedText === deltaText,
    streamedMatchesCompleted: streamedText === completedText,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!completedText.trimEnd().endsWith(marker)) {
    throw new Error(
      `The provider's completed message did not contain ${marker}, so this run cannot distinguish an adapter truncation from model instruction-following.`,
    );
  }

  if (
    streamedText !== completedText ||
    !streamedText.trimEnd().endsWith(marker)
  ) {
    throw new Error(
      `Reproduced issue #13836: the SDK stream omitted text present in the provider's completed message.`,
    );
  }
}

async function main() {
  await runOnce(1);
  await runOnce(2);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
