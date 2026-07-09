import { spawn } from 'node:child_process';
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateReadableStream } from 'ai';

const issueId = 'issue-11300';
const bunVersion = '1.3.3';
const aiVersion = '5.0.108';

type CommandResult = {
  stdout: string;
  stderr: string;
};

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on('data', chunk => stdoutChunks.push(chunk));
  child.stderr.on('data', chunk => stderrChunks.push(chunk));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  const result = {
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };

  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed with exit code ${exitCode}: ${command} ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return result;
}

async function assertWorkspaceImport() {
  if (typeof simulateReadableStream !== 'function') {
    throw new Error('simulateReadableStream is not exported as a function');
  }

  const firstChunk = await simulateReadableStream({
    chunks: ['workspace-ok'],
  })
    .getReader()
    .read();

  if (firstChunk.value !== 'workspace-ok') {
    throw new Error(
      `Unexpected workspace stream chunk: ${JSON.stringify(firstChunk)}`,
    );
  }
}

async function main() {
  await assertWorkspaceImport();

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = resolve(currentDir, '../../../..');
  const tempRoot = join(workspaceRoot, 'tmp', issueId);
  const bunInstallRoot = join(tempRoot, 'bun-install');
  const appRoot = join(tempRoot, 'app');
  const bunBin = join(
    bunInstallRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'bun.cmd' : 'bun',
  );

  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(bunInstallRoot, { recursive: true });
  await mkdir(appRoot, { recursive: true });

  await runCommand(
    'npm',
    ['install', '--prefix', bunInstallRoot, `bun@${bunVersion}`, '--silent'],
    { cwd: workspaceRoot },
  );

  const installedBunVersion = (
    await runCommand(bunBin, ['--version'], {
      cwd: workspaceRoot,
    })
  ).stdout.trim();

  if (installedBunVersion !== bunVersion) {
    throw new Error(
      `Expected Bun ${bunVersion}, got ${installedBunVersion || 'no output'}`,
    );
  }

  await writeFile(
    join(appRoot, 'package.json'),
    JSON.stringify(
      {
        name: issueId,
        private: true,
        type: 'module',
        dependencies: {
          ai: aiVersion,
        },
      },
      null,
      2,
    ),
  );

  await runCommand(bunBin, ['install'], { cwd: appRoot });
  await runCommand(bunBin, ['install', '--frozen-lockfile'], { cwd: appRoot });

  await writeFile(
    join(appRoot, 'repro.ts'),
    [
      'import { simulateReadableStream } from "ai";',
      '',
      'console.log(`simulateReadableStream type: ${typeof simulateReadableStream}`);',
      'const firstChunk = await simulateReadableStream({ chunks: ["ok"] })',
      '  .getReader()',
      '  .read();',
      'console.log(`first chunk: ${firstChunk.value}`);',
      '',
    ].join('\n'),
  );

  const publishedPackageResult = await runCommand(bunBin, ['repro.ts'], {
    cwd: appRoot,
  });

  const indexMjs = await readFile(
    join(appRoot, 'node_modules', 'ai', 'dist', 'index.mjs'),
    'utf8',
  );

  if (!indexMjs.includes('simulateReadableStream')) {
    throw new Error('ai@5.0.108 dist/index.mjs does not contain export text');
  }

  const expectedLines = [
    'simulateReadableStream type: function',
    'first chunk: ok',
  ];

  for (const line of expectedLines) {
    if (!publishedPackageResult.stdout.includes(line)) {
      throw new Error(
        `Expected Bun output to include ${JSON.stringify(line)}, got:\n${
          publishedPackageResult.stdout
        }`,
      );
    }
  }

  console.log(
    [
      `workspace ai import: simulateReadableStream returned workspace-ok`,
      `published ai@${aiVersion} import with Bun ${bunVersion}:`,
      publishedPackageResult.stdout.trim(),
    ].join('\n'),
  );

  await rm(tempRoot, { recursive: true, force: true });
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
