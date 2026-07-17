import { createGateway, generateText } from 'ai';

async function main() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  if (!apiKey) {
    throw new Error('AI_GATEWAY_API_KEY is required for this reproduction.');
  }

  let forwardedAuthorization: string | null = null;

  const gateway = createGateway({
    apiKey,
    fetch: async (input, init) => {
      forwardedAuthorization = new Headers(init?.headers).get('authorization');
      return fetch(input, init);
    },
  });

  const result = await generateText({
    model: gateway('openai/gpt-4.1-nano'),
    prompt: 'Reply with exactly gateway-ok.',
    maxOutputTokens: 20,
  });

  if (forwardedAuthorization !== `Bearer ${apiKey}`) {
    throw new Error('The explicit AI Gateway API key was not forwarded.');
  }

  if (result.text.trim() !== 'gateway-ok') {
    throw new Error(
      `AI Gateway returned unexpected text: ${JSON.stringify(result.text)}`,
    );
  }

  console.log(
    'Issue #7447 could not be reproduced: the explicit API key was forwarded and AI Gateway returned gateway-ok.',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
