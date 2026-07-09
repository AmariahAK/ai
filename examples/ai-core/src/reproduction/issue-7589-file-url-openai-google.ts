import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText, type ModelMessage } from 'ai';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const pdfUrl =
  'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

const messages: ModelMessage[] = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Read the PDF. What exact words appear in the document? Answer concisely.',
      },
      {
        type: 'file',
        data: pdfUrl,
        mediaType: 'application/pdf',
        filename: 'dummy.pdf',
      },
    ],
  },
];

type ProviderResult = {
  provider: 'openai' | 'google';
  model: string;
  pdfUrl: string;
  ok: boolean;
  text?: string;
  errorName?: string;
  errorMessage?: string;
};

function hasReadDummyPdf(text: string | undefined): boolean {
  const normalized = text?.toLowerCase() ?? '';
  return normalized.includes('dummy') && normalized.includes('pdf');
}

async function runProvider(
  provider: ProviderResult['provider'],
  model: string,
): Promise<ProviderResult> {
  try {
    const result = await generateText({
      model: provider === 'openai' ? openai(model) : google(model),
      messages,
    });

    return {
      provider,
      model,
      pdfUrl,
      ok: true,
      text: result.text,
    };
  } catch (error) {
    return {
      provider,
      model,
      pdfUrl,
      ok: false,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeFixture(result: ProviderResult): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '../../../..');
  const fixtureDir = path.join(
    repoRoot,
    'packages',
    result.provider,
    'src',
    '__fixtures__',
  );
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    path.join(fixtureDir, 'issue-7589-file-url.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

async function main() {
  const results = await Promise.all([
    runProvider('openai', 'gpt-4.1-mini'),
    runProvider('google', 'gemini-2.5-flash'),
  ]);

  for (const result of results) {
    await writeFixture(result);
    console.log(JSON.stringify(result, null, 2));
  }

  const failures = results.filter(
    result => !result.ok || !hasReadDummyPdf(result.text),
  );

  if (failures.length > 0) {
    throw new Error(
      `Issue #7589 reproduced for ${failures
        .map(result => `${result.provider}/${result.model}`)
        .join(', ')}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
