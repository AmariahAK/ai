import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'ai-issue-10014-'));

  try {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify(
        {
          private: true,
          type: 'module',
          dependencies: {
            '@openrouter/ai-sdk-provider': '1.1.0',
            ai: '5.0.86',
            zod: '4.1.12',
          },
          devDependencies: {
            '@types/json-schema': '7.0.15',
            '@types/node': '22.20.1',
            typescript: '5.9.3',
          },
        },
        null,
        2,
      ),
    );

    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            module: 'ESNext',
            moduleResolution: 'Bundler',
            noEmit: true,
            skipLibCheck: false,
            strict: true,
            target: 'ES2022',
          },
          include: ['index.ts'],
        },
        null,
        2,
      ),
    );

    await writeFile(
      join(directory, 'index.ts'),
      `import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';

const openrouter = createOpenRouter({ apiKey: 'not-used-by-typecheck' });

void generateObject({
  model: openrouter('openai/gpt-4o-mini'),
  schema: z.object({
    pretranslatedPhrase: z.string().describe('The phrase before translation'),
    translatedPhrase: z.string().describe('The phrase after translation'),
    sourceLanguage: z.string(),
    targetLanguage: z.string(),
  }),
  prompt: 'Translate hello to French.',
});
`,
    );

    await execFileAsync(
      'pnpm',
      [
        'install',
        '--ignore-workspace',
        '--frozen-lockfile=false',
        '--reporter=silent',
      ],
      {
        cwd: directory,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    await execFileAsync('pnpm', ['exec', 'tsc', '--pretty', 'false'], {
      cwd: directory,
      maxBuffer: 10 * 1024 * 1024,
    });

    console.log(
      'Could not reproduce: generateObject accepts a Zod 4.1.12 object schema with ai 5.0.86 and @openrouter/ai-sdk-provider 1.1.0.',
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
