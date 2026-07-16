import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { generateText } from 'ai';
import fs from 'node:fs';

const modelId =
  'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123xyz';
const expectedUrl =
  `https://bedrock-runtime.us-east-1.amazonaws.com/model/` +
  `${encodeURIComponent(modelId)}/converse`;

async function main() {
  const fixture = fs.readFileSync(
    new URL(
      '../../../../packages/amazon-bedrock/src/__fixtures__/issue-14117-application-inference-profile-success.json',
      import.meta.url,
    ),
    'utf8',
  );
  let requestUrl: string | undefined;

  const bedrock = createAmazonBedrock({
    region: 'us-east-1',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    fetch: async input => {
      requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      return new Response(fixture, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await generateText({
    model: bedrock(modelId),
    prompt: 'Reply with exactly: hello',
    maxOutputTokens: 10,
    maxRetries: 0,
  });

  if (requestUrl !== expectedUrl) {
    throw new Error(
      `Unexpected Bedrock application inference profile URL: ${requestUrl}`,
    );
  }
  if (result.text !== 'hello') {
    throw new Error(`Expected generateText to return "hello": ${result.text}`);
  }

  console.log(
    'Issue #14117 not reproduced: generateText returned "hello" for an application inference profile ARN.',
  );
  console.log(`Request URL: ${requestUrl}`);
}

main();
