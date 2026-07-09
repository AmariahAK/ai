import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function runCommand({
  command,
  args,
  cwd,
  env,
}: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });

  const combinedOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        `cwd: ${cwd}`,
        `exit status: ${result.status}`,
        combinedOutput,
      ].join('\n'),
    );
  }

  return combinedOutput;
}

function findBun() {
  if (process.env.BUN_PATH != null) {
    return process.env.BUN_PATH;
  }

  if (existsSync('/work/.bun/bin/bun')) {
    return '/work/.bun/bin/bun';
  }

  return 'bun';
}

function getRepoRoot() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDirectory, '../../../..');
}

function getImportCheckSource(expectedChunk: string) {
  return `
import { simulateReadableStream } from 'ai';

async function main() {
  if (typeof simulateReadableStream !== 'function') {
    throw new Error(\`simulateReadableStream import was \${typeof simulateReadableStream}\`);
  }

  const stream = simulateReadableStream({
    chunks: ['${expectedChunk}'],
    initialDelayInMs: null,
    chunkDelayInMs: null,
  });

  const reader = stream.getReader();
  const firstRead = await reader.read();
  const secondRead = await reader.read();

  if (firstRead.done || firstRead.value !== '${expectedChunk}') {
    throw new Error(\`unexpected first read: \${JSON.stringify(firstRead)}\`);
  }

  if (!secondRead.done) {
    throw new Error(\`stream did not close: \${JSON.stringify(secondRead)}\`);
  }

  console.log(JSON.stringify({
    importedType: typeof simulateReadableStream,
    firstChunk: firstRead.value,
    closed: secondRead.done,
  }));
}

main();
`;
}

async function main() {
  const bun = findBun();
  const repoRoot = getRepoRoot();
  const workspaceExample = join(repoRoot, 'examples/ai-core');
  const tempRoot = await mkdtemp(
    join(tmpdir(), 'issue-11300-simulate-readable-stream-'),
  );

  try {
    const bunVersion = runCommand({
      command: bun,
      args: ['--version'],
      cwd: repoRoot,
    });

    console.log(`Bun version: ${bunVersion}`);

    const workspaceOutput = runCommand({
      command: bun,
      args: ['-e', getImportCheckSource('workspace-ok')],
      cwd: workspaceExample,
    });

    console.log(`workspace ai import: ${workspaceOutput}`);

    await writeFile(
      join(tempRoot, 'package.json'),
      `${JSON.stringify(
        {
          private: true,
          type: 'module',
          dependencies: {
            ai: '5.0.108',
          },
        },
        null,
        2,
      )}\n`,
    );

    await writeFile(
      join(tempRoot, 'index.ts'),
      getImportCheckSource('published-ok'),
    );

    runCommand({
      command: bun,
      args: ['install'],
      cwd: tempRoot,
      env: { BUN_INSTALL_CACHE_DIR: join(tempRoot, '.bun-cache') },
    });

    await rm(join(tempRoot, 'node_modules'), {
      recursive: true,
      force: true,
    });

    runCommand({
      command: bun,
      args: ['install', '--frozen-lockfile'],
      cwd: tempRoot,
      env: { BUN_INSTALL_CACHE_DIR: join(tempRoot, '.bun-cache') },
    });

    const installedIndex = await readFile(
      join(tempRoot, 'node_modules/ai/dist/index.mjs'),
      'utf8',
    );

    if (!installedIndex.includes('simulateReadableStream')) {
      throw new Error(
        'published ai@5.0.108 dist/index.mjs does not contain simulateReadableStream',
      );
    }

    const publishedOutput = runCommand({
      command: bun,
      args: ['index.ts'],
      cwd: tempRoot,
      env: { BUN_INSTALL_CACHE_DIR: join(tempRoot, '.bun-cache') },
    });

    console.log(`published ai@5.0.108 import: ${publishedOutput}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
