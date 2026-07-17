const expectedLifecycle = [
  'reasoning-start',
  'reasoning-delta',
  'reasoning-end',
  'text-start',
  'text-delta',
  'text-end',
];

async function main() {
  const [{ AIMessageChunk }, { toUIMessageStream }] = await Promise.all([
    import('../../../../packages/langchain/node_modules/@langchain/core/messages.js'),
    import('../../../../packages/langchain/dist/index.mjs'),
  ]);

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

  const chunks: Array<{ type: string }> = [];
  const reader = toUIMessageStream(input).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }

  const lifecycle = chunks
    .map(chunk => chunk.type)
    .filter(type => type.startsWith('reasoning-') || type.startsWith('text-'));

  console.log(`Expected lifecycle: ${expectedLifecycle.join(' -> ')}`);
  console.log(`Observed lifecycle: ${lifecycle.join(' -> ')}`);

  if (lifecycle.join(',') !== expectedLifecycle.join(',')) {
    throw new Error(
      'Issue #17413 reproduced: reasoning-end occurred after text-end, so reasoning and text lifecycles overlapped',
    );
  }
}

main();
