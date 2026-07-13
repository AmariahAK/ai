import { createGateway } from '@ai-sdk/gateway';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { streamText } from 'ai';

const fixturePath = fileURLToPath(
  new URL(
    '../../../../packages/gateway/src/__fixtures__/openai-gpt-5.2-stream.sse.txt',
    import.meta.url,
  ),
);

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return result + decoder.decode();
    }
    result += decoder.decode(value, { stream: true });
  }
}

async function main() {
  let recordedResponse: Promise<string> | undefined;

  const gateway = createGateway({
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.body == null) {
        return response;
      }

      const [sdkBody, fixtureBody] = response.body.tee();
      recordedResponse = readStream(fixtureBody);

      return new Response(sdkBody, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    },
  });

  const result = streamText({
    model: gateway('openai/gpt-5.2'),
    prompt: 'Reply with exactly: stream completed',
    maxOutputTokens: 20,
    timeout: {
      totalMs: 90_000,
      chunkMs: 30_000,
    },
  });

  let text = '';
  const eventTypes: string[] = [];

  for await (const part of result.fullStream) {
    eventTypes.push(part.type);
    if (part.type === 'text-delta') {
      text += part.text;
    }
  }

  assert.ok(recordedResponse, 'Expected to record the Gateway response');
  const responseBody = await recordedResponse;
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, responseBody);

  assert.ok(text.length > 0, 'Expected the stream to produce text');
  assert.ok(
    eventTypes.includes('finish'),
    'Expected the stream to emit a finish event instead of getting stuck',
  );

  console.log(
    JSON.stringify(
      {
        eventTypes,
        finishReason: await result.finishReason,
        text,
        usage: await result.usage,
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
