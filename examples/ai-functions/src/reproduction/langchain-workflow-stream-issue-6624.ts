import assert from 'node:assert/strict';

type UIMessageChunk = {
  type: string;
  delta?: string;
};

const expectedText = 'Hello from workflow';

async function createWorkflow() {
  const packagesDirectory = new URL(
    '../../../../packages/langchain/',
    import.meta.url,
  );

  const [{ StateGraph, MessagesAnnotation }, { AIMessage, HumanMessage }] =
    await Promise.all([
      import(
        new URL(
          'node_modules/@langchain/langgraph/dist/index.js',
          packagesDirectory,
        ).href
      ),
      import(
        new URL(
          'node_modules/@langchain/core/dist/messages/index.js',
          packagesDirectory,
        ).href
      ),
    ]);

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', async () => ({
      messages: [new AIMessage({ content: expectedText })],
    }))
    .addEdge('__start__', 'agent')
    .addEdge('agent', '__end__')
    .compile();

  return {
    HumanMessage,
    workflow,
  };
}

async function main() {
  const packagesDirectory = new URL(
    '../../../../packages/langchain/',
    import.meta.url,
  );
  const { toUIMessageStream } = await import(
    new URL('dist/index.js', packagesDirectory).href
  );
  const { HumanMessage, workflow } = await createWorkflow();

  // This is the standard workflow.stream() call from the issue: no explicit
  // streamMode is supplied.
  const workflowStream = await workflow.stream({
    messages: [new HumanMessage({ content: 'Hi' })],
  });

  const outputChunks: UIMessageChunk[] = [];
  for await (const chunk of toUIMessageStream(workflowStream)) {
    outputChunks.push(chunk);
  }

  const streamedText = outputChunks
    .filter(chunk => chunk.type === 'text-delta')
    .map(chunk => chunk.delta ?? '')
    .join('');

  console.log(JSON.stringify(outputChunks, null, 2));

  assert.equal(
    streamedText,
    expectedText,
    'LangChain workflow.stream() completed without streaming the workflow response text',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
