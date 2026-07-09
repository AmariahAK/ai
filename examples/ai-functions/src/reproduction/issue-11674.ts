import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const fixturePath = path.resolve(
  process.cwd(),
  '../../packages/anthropic/src/__fixtures__/anthropic-issue-11674-empty-schema-forced-tool-call.1.chunks.txt',
);

async function main() {
  let executeCount = 0;

  const result = streamText({
    model: anthropic('claude-haiku-4-5'),
    include: { rawChunks: true },
    tools: {
      sayHello: tool({
        description: 'Say hello',
        inputSchema: z.object({}),
        execute: async ({}) => {
          executeCount++;
          return 'Hello!';
        },
      }),
    },
    toolChoice: {
      type: 'tool',
      toolName: 'sayHello',
    },
    prompt: 'Say hello!',
  });

  const parts: Array<{ type: string; [key: string]: unknown }> = [];
  const rawChunks: unknown[] = [];

  for await (const part of result.stream) {
    parts.push(part as { type: string; [key: string]: unknown });

    switch (part.type) {
      case 'raw':
        rawChunks.push(part.rawValue);
        break;
      case 'tool-call':
      case 'tool-result':
      case 'finish-step':
      case 'finish':
      case 'error':
        console.log(JSON.stringify(part, null, 2));
        break;
    }
  }

  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  await fs.writeFile(
    fixturePath,
    rawChunks.map(chunk => JSON.stringify(chunk)).join('\n') +
      (rawChunks.length > 0 ? '\n' : ''),
  );

  const sayHelloToolCalls = parts.filter(
    part => part.type === 'tool-call' && part.toolName === 'sayHello',
  );
  const sayHelloToolResults = parts.filter(
    part => part.type === 'tool-result' && part.toolName === 'sayHello',
  );
  const finishStep = parts.find(part => part.type === 'finish-step');

  const summary = {
    executeCount,
    fixturePath,
    rawChunkCount: rawChunks.length,
    sawSayHelloToolCall: sayHelloToolCalls.length > 0,
    sawSayHelloToolResult: sayHelloToolResults.length > 0,
    finishReason: finishStep?.finishReason,
    rawFinishReason: finishStep?.rawFinishReason,
    streamedPartTypes: parts.map(part => part.type),
  };

  console.log('issue-11674 summary:');
  console.log(JSON.stringify(summary, null, 2));

  if (rawChunks.length === 0) {
    throw new Error(
      `Expected to record raw Anthropic stream chunks in ${fixturePath}, but none were emitted.`,
    );
  }

  if (sayHelloToolCalls.length === 0) {
    throw new Error(
      'Expected streamText to emit a sayHello tool-call for the forced empty-schema tool, but no sayHello tool-call was emitted.',
    );
  }

  if (executeCount === 0) {
    throw new Error(
      'Expected the forced empty-schema sayHello tool to execute, but execute() was not called.',
    );
  }

  if (sayHelloToolResults.length === 0) {
    throw new Error(
      'Expected streamText to emit a sayHello tool-result after executing the forced empty-schema tool, but no sayHello tool-result was emitted.',
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
