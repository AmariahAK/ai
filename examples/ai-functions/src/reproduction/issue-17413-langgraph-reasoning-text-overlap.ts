import { AIMessageChunk } from '../../../../packages/langchain/node_modules/@langchain/core/messages';
import { toUIMessageStream } from '../../../../packages/langchain/dist/index.js';

async function main() {
  const reasoning = new AIMessageChunk({
    id: 'message-1',
    content: [{ type: 'reasoning', reasoning: 'Thinking...' }],
  });

  const text = new AIMessageChunk({
    id: 'message-1',
    content: 'Answer',
  });

  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(['messages', [reasoning]]);
      controller.enqueue(['messages', [text]]);
      controller.enqueue(['values', {}]);
      controller.close();
    },
  });

  const chunks = [];
  const reader = toUIMessageStream(input).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const lifecycle = chunks
    .map(chunk => chunk.type)
    .filter(type => type !== 'start' && type !== 'finish');
  const expected = [
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'text-start',
    'text-delta',
    'text-end',
  ];

  if (lifecycle.join(',') !== expected.join(',')) {
    throw new Error(
      `ISSUE #17413 REPRODUCED: reasoning and text lifecycles overlap; observed ${lifecycle.join(
        ' -> ',
      )}; expected ${expected.join(' -> ')}`,
    );
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
