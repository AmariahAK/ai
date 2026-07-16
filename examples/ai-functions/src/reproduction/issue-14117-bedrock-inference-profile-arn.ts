import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { generateText } from 'ai';

async function main() {
  const inferenceProfileArn = process.env.ISSUE_14117_INFERENCE_PROFILE_ARN;

  if (inferenceProfileArn == null) {
    throw new Error(
      'Set ISSUE_14117_INFERENCE_PROFILE_ARN to an active Amazon Bedrock application inference profile ARN.',
    );
  }

  const arnMatch = inferenceProfileArn.match(
    /^arn:aws:bedrock:([^:]+):\d{12}:application-inference-profile\/.+$/,
  );

  if (arnMatch == null) {
    throw new Error(
      'ISSUE_14117_INFERENCE_PROFILE_ARN must be an Amazon Bedrock application inference profile ARN.',
    );
  }

  let requestUrl: string | undefined;
  const captureFetch: typeof fetch = async (input, init) => {
    requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return fetch(input, init);
  };

  const bedrock = createAmazonBedrock({
    region: arnMatch[1],
    fetch: captureFetch,
  });

  const result = await generateText({
    model: bedrock(inferenceProfileArn),
    prompt: 'Say hello in one word.',
  });

  if (result.text.length === 0) {
    throw new Error(
      'ISSUE_14117_REPRODUCED: generateText returned no text for the application inference profile ARN.',
    );
  }

  console.log(
    'ISSUE_14117_COULD_NOT_REPRODUCE: generateText succeeded with an application inference profile ARN.',
  );
  console.log(`Request URL: ${requestUrl}`);
  console.log(`Generated text: ${result.text}`);
}

main();
