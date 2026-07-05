import assert from 'node:assert/strict';

import { convertUserContent } from '../../../../packages/langchain/src/utils';

async function main() {
  const imageUrl = 'https://example.com/image.jpg';

  const message = convertUserContent([
    { type: 'text', text: 'What is in this image?' },
    { type: 'image', image: imageUrl },
  ]);

  const expectedLangChainContent = [
    { type: 'text', text: 'What is in this image?' },
    { type: 'image', url: imageUrl },
  ];

  console.log(
    'convertUserContent output:',
    JSON.stringify(message.content, null, 2),
  );

  assert.deepEqual(
    message.content,
    expectedLangChainContent,
    'Expected LangChain canonical image ContentBlock, but convertUserContent emitted a provider-specific image_url block.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
