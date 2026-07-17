import 'dotenv/config';
import { createGateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';

async function main() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  let explicitApiKeyWasForwarded = false;

  const gateway = createGateway({
    apiKey,
    fetch: async (input, init) => {
      explicitApiKeyWasForwarded =
        new Headers(init?.headers).get('authorization') === `Bearer ${apiKey}`;
      return fetch(input, init);
    },
  });

  const result = await generateText({
    model: gateway('openai/gpt-5-nano'),
    prompt: 'Reply with exactly: OK',
    maxOutputTokens: 10,
  });

  if (!explicitApiKeyWasForwarded) {
    throw new Error(
      'The explicit createGateway apiKey was not forwarded to AI Gateway.',
    );
  }

  console.log('AI Gateway access succeeded with an explicit apiKey.');
  console.log(`Finish reason: ${result.finishReason}`);
}

main().catch(error => {
  console.error(
    'Issue #7447: AI Gateway access failed with an explicit apiKey.',
  );
  console.error(error);
  process.exitCode = 1;
});
