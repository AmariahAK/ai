async function main() {
  const originalBaseURL = process.env.ANTHROPIC_BASE_URL;
  const observedUrls: string[] = [];

  try {
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { generateText } = await import('ai');

    const anthropic = createAnthropic({
      apiKey: 'test-api-key',
      fetch: async url => {
        observedUrls.push(url.toString());

        return new Response(
          JSON.stringify({
            type: 'message',
            id: 'msg_issue_15580',
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'OK' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    });

    const result = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      prompt: 'Say OK.',
      maxOutputTokens: 1,
    });

    const observedUrl = observedUrls[0];
    const expectedUrl = 'https://api.anthropic.com/v1/messages';
    const reportedBugUrl = 'https://api.anthropic.com/messages';

    console.log(
      JSON.stringify(
        {
          text: result.text,
          observedUrl,
          expectedUrl,
          reportedBugUrl,
        },
        null,
        2,
      ),
    );

    if (observedUrl !== expectedUrl) {
      throw new Error(
        `Expected ${expectedUrl}, but @ai-sdk/anthropic requested ${observedUrl}`,
      );
    }
  } finally {
    if (originalBaseURL === undefined) {
      delete process.env.ANTHROPIC_BASE_URL;
    } else {
      process.env.ANTHROPIC_BASE_URL = originalBaseURL;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
