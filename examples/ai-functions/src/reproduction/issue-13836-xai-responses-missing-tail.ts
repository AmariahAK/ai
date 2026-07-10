import { xai } from '@ai-sdk/xai';
import { streamText } from 'ai';
import fs from 'node:fs';

const fixturePath =
  '../../packages/xai/src/responses/__fixtures__/issue-13836-xai-responses-missing-tail.chunks.txt';
const marker = 'END_OK_9981';

const prompt = `Return only the requested content, with no introduction or conclusion.

1. Write a numbered list from 1 to 120.
2. Each line must be exactly: <N>. alfa beta gama delta epsilon zeta eta theta iota kappa lambda mu
3. Then write a JavaScript code block with 80 numbered comment lines: // 1 through // 80
4. End after the code block with the exact line: ${marker}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function getCompletedMessageText(rawChunks: unknown[]): string | undefined {
  let completedText: string | undefined;

  for (const rawChunk of rawChunks) {
    if (
      !isRecord(rawChunk) ||
      rawChunk.type !== 'response.output_item.done' ||
      !isRecord(rawChunk.item) ||
      rawChunk.item.type !== 'message' ||
      !Array.isArray(rawChunk.item.content)
    ) {
      continue;
    }

    for (const contentPart of rawChunk.item.content) {
      if (
        isRecord(contentPart) &&
        contentPart.type === 'output_text' &&
        typeof contentPart.text === 'string'
      ) {
        completedText = (completedText ?? '') + contentPart.text;
      }
    }
  }

  return completedText;
}

async function main() {
  const result = streamText({
    model: xai.responses('grok-4-1-fast-non-reasoning'),
    maxOutputTokens: 6000,
    temperature: 0,
    prompt,
    include: {
      rawChunks: true,
    },
  });

  const rawChunks: unknown[] = [];
  let streamedText = '';
  let finishReason: string | undefined;

  for await (const part of result.fullStream) {
    if (part.type === 'raw') {
      rawChunks.push(part.rawValue);
    } else if (part.type === 'text-delta') {
      streamedText += part.text;
    } else if (part.type === 'finish') {
      finishReason = part.finishReason;
    }
  }

  fs.writeFileSync(
    fixturePath,
    `${rawChunks.map(chunk => JSON.stringify(chunk)).join('\n')}\n`,
  );

  const completedText = getCompletedMessageText(rawChunks);
  const output = {
    model: 'grok-4-1-fast-non-reasoning',
    finishReason,
    streamedLength: streamedText.length,
    completedLength: completedText?.length,
    streamedHasMarker: streamedText.includes(marker),
    completedHasMarker: completedText?.includes(marker),
    streamMatchesCompletedItem: streamedText === completedText,
    missingSuffix:
      completedText != null && completedText.startsWith(streamedText)
        ? completedText.slice(streamedText.length)
        : undefined,
    fixturePath,
  };

  console.log(JSON.stringify(output, null, 2));

  if (completedText == null) {
    throw new Error(
      'The live xAI stream did not contain a completed message item to compare against.',
    );
  }

  if (!completedText.includes(marker)) {
    throw new Error(
      `The live provider output did not include ${marker}, so this run cannot test whether the adapter dropped that final text.`,
    );
  }

  if (streamedText !== completedText || !streamedText.includes(marker)) {
    throw new Error(
      `Reproduced issue #13836: the SDK stream omitted text present in the completed xAI message (missing ${completedText.length - streamedText.length} characters).`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
