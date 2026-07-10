import { spawn } from 'node:child_process';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function run(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';

    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', exitCode => {
      resolve({ exitCode: exitCode ?? 1, output });
    });
  });
}

async function main() {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../..',
  );
  const fixtureDirectory = path.join(
    repositoryRoot,
    '.tmp',
    'issue-8644-next-app',
  );
  const nextExampleDirectory = path.join(
    repositoryRoot,
    'examples',
    'ai-e2e-next',
  );

  await rm(fixtureDirectory, { recursive: true, force: true });
  await mkdir(path.join(fixtureDirectory, 'app'), { recursive: true });

  try {
    await Promise.all([
      writeFile(
        path.join(fixtureDirectory, 'package.json'),
        JSON.stringify(
          {
            name: 'issue-8644-reproduction',
            private: true,
          },
          null,
          2,
        ),
      ),
      writeFile(
        path.join(fixtureDirectory, 'app', 'layout.tsx'),
        [
          'export default function RootLayout({',
          '  children,',
          '}: Readonly<{ children: React.ReactNode }>) {',
          '  return <html><body>{children}</body></html>;',
          '}',
          '',
        ].join('\n'),
      ),
      writeFile(
        path.join(fixtureDirectory, 'app', 'page.tsx'),
        [
          "'use client';",
          '',
          "import { useCompletion } from '@ai-sdk/react';",
          '',
          'export default function Page() {',
          '  const { completion } = useCompletion();',
          '  return <main>{completion}</main>;',
          '}',
          '',
        ].join('\n'),
      ),
      symlink(
        path.join(nextExampleDirectory, 'node_modules'),
        path.join(fixtureDirectory, 'node_modules'),
        'dir',
      ),
    ]);

    const nextBinary = path.join(
      nextExampleDirectory,
      'node_modules',
      '.bin',
      'next',
    );
    const result = await run(nextBinary, ['build'], {
      cwd: fixtureDirectory,
    });

    console.log(result.output);

    if (result.exitCode !== 0) {
      throw new Error(
        `Expected the Next.js client component to build without an SWR import error, but next build exited with code ${result.exitCode}.`,
      );
    }
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
