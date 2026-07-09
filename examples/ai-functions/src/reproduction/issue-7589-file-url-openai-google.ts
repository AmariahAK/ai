import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText, type ModelMessage } from 'ai';

const pdfUrl = new URL(
  'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
);

const messages = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Read the attached PDF and reply with the exact short phrase printed in it.',
      },
      {
        type: 'file',
        data: pdfUrl,
        mediaType: 'application/pdf',
        filename: 'dummy.pdf',
      },
    ],
  },
] satisfies ModelMessage[];

async function assertPdfUrlWorks({
  providerName,
  model,
}: {
  providerName: string;
  model: Parameters<typeof generateText>[0]['model'];
}) {
  const result = await generateText({
    model,
    messages,
    maxOutputTokens: 64,
    temperature: 0,
  });

  console.log(`${providerName} response:`, JSON.stringify(result.text));

  if (!/dummy/i.test(result.text)) {
    throw new Error(
      `${providerName} did not appear to read the PDF URL; expected "dummy" in response.`,
    );
  }
}

async function main() {
  await assertPdfUrlWorks({
    providerName: 'OpenAI',
    model: openai('gpt-4.1-mini'),
  });

  await assertPdfUrlWorks({
    providerName: 'Google',
    model: google('gemini-2.5-flash'),
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
