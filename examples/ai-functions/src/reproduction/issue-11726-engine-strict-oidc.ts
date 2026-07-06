import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function runPnpmInstall(cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['install', '--lockfile-only', '--ignore-workspace'],
      {
        cwd,
        stdio: 'inherit',
      },
    );

    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
}

async function main() {
  const projectDir = path.join(
    process.cwd(),
    '.tmp-reproduction-issue-11726',
  );

  await rm(projectDir, { recursive: true, force: true });
  await mkdir(projectDir, { recursive: true });

  await writeFile(
    path.join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          ai: '6.0.22',
          '@ai-sdk/gateway': '3.0.11',
        },
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(
    path.join(projectDir, '.npmrc'),
    [
      // Simulate a Node 18 project with strict engine checks.
      // pnpm uses this value for package engine validation.
      'engine-strict=true',
      'node-version=18.20.0',
      '',
    ].join('\n'),
  );

  try {
    const exitCode = await runPnpmInstall(projectDir);

    if (exitCode === 0) {
      throw new Error(
        'Expected pnpm install to fail because @vercel/oidc requires Node >=20, but it succeeded.',
      );
    }

    process.exitCode = exitCode;
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
