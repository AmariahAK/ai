import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  access,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const compilerName = process.argv[2];
const expectedVersion = process.argv[3];

if (compilerName == null || expectedVersion == null) {
  throw new Error(
    'Usage: node tools/type-check-lifecycle.mjs <compiler> <version>',
  );
}

if (compilerName !== 'tsc' && compilerName !== 'tsc6') {
  throw new Error(`Unsupported compiler: ${compilerName}`);
}

if (
  process.env.CI !== 'true' &&
  process.env.TYPE_CHECK_LIFECYCLE !== '1'
) {
  throw new Error(
    'This check cleans compiler outputs. Set TYPE_CHECK_LIFECYCLE=1 to run it locally.',
  );
}

const compiler = path.join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? `${compilerName}.cmd` : compilerName,
);
const rootConfig = 'tsconfig.with-examples.json';
const probeConfig = 'packages/xai/tsconfig.json';
const probeSource = path.join(workspaceRoot, 'packages/xai/src/version.ts');
const probeOutput = path.join(workspaceRoot, 'packages/xai/dist/version.js');
const probeName = '__typeCheckLifecycleProbe';
const probeDeclaration = `\nexport const ${probeName} = true;\n`;
const originalSource = await readFile(probeSource);
const activeChildren = new Set();
let sourceIsModified = false;

const restoreSourceSync = () => {
  if (sourceIsModified) {
    writeFileSync(probeSource, originalSource);
    sourceIsModified = false;
  }
};

const exitOnSignal = code => {
  restoreSourceSync();
  for (const child of activeChildren) child.kill('SIGTERM');
  process.exit(code);
};

process.once('SIGINT', () => exitOnSignal(130));
process.once('SIGTERM', () => exitOnSignal(143));

const run = args =>
  new Promise((resolve, reject) => {
    const child = spawn(compiler, args, {
      cwd: workspaceRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.add(child);
    let output = '';
    let timedOut = false;
    let killTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, 10 * 60_000);

    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      activeChildren.delete(child);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', chunk => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.once('error', error => {
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      if (timedOut) {
        reject(
          new Error(
            `${compilerName} ${args.join(' ')} timed out after 10 minutes.`,
          ),
        );
      } else if (code === 0) {
        resolve(output.trim());
      } else {
        reject(
          new Error(
            `${compilerName} ${args.join(' ')} exited with ${
              signal == null ? `code ${code}` : `signal ${signal}`
            }.`,
          ),
        );
      }
    });
  });

const build = config =>
  run(['--build', config, '--pretty', 'false']);

const readProbeOutput = async () => readFile(probeOutput, 'utf8');

class FatalWatchError extends Error {}

const setProbe = async enabled => {
  await writeFile(
    probeSource,
    enabled
      ? Buffer.concat([originalSource, Buffer.from(probeDeclaration)])
      : originalSource,
  );
  sourceIsModified = enabled;
};

const waitFor = async (description, predicate, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      if (error instanceof FatalWatchError) throw error;
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for ${description}.${
      lastError == null ? '' : ` Last error: ${lastError.message}`
    }`,
  );
};

const stopWatcher = async (watcher, watcherExit) => {
  if (watcher.exitCode != null || watcher.signalCode != null) return;

  watcher.kill('SIGTERM');
  const stopped = await Promise.race([
    watcherExit.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 5_000)),
  ]);

  if (!stopped) {
    watcher.kill('SIGKILL');
    await watcherExit;
  }
};

const version = await run(['--version']);
if (version !== `Version ${expectedVersion}`) {
  throw new Error(
    `Expected ${compilerName} ${expectedVersion}, received ${version}.`,
  );
}

process.stdout.write(`Cleaning the ${compilerName} project graph.\n`);
await run(['--build', rootConfig, '--clean']);

process.stdout.write(`Running a clean ${compilerName} full build.\n`);
await build(rootConfig);

process.stdout.write(`Checking ${compilerName} incremental reuse.\n`);
const outputBeforeIncremental = await stat(probeOutput, { bigint: true });
await build(rootConfig);
const outputAfterIncremental = await stat(probeOutput, { bigint: true });
if (outputAfterIncremental.mtimeNs !== outputBeforeIncremental.mtimeNs) {
  throw new Error(
    `${compilerName} re-emitted an unchanged project during an incremental build.`,
  );
}

process.stdout.write(`Checking a changed leaf with ${compilerName}.\n`);
try {
  await setProbe(true);
  await build(probeConfig);
  if (!(await readProbeOutput()).includes(probeName)) {
    throw new Error(`${compilerName} did not emit the changed leaf.`);
  }
} finally {
  if (sourceIsModified) await setProbe(false);
  await build(probeConfig);
}

if ((await readProbeOutput()).includes(probeName)) {
  throw new Error(`${compilerName} retained the restored leaf probe.`);
}

process.stdout.write(
  `Checking forced deleted-output recovery with ${compilerName}.\n`,
);
await unlink(probeOutput);
await run(['--build', probeConfig, '--force', '--pretty', 'false']);
await access(probeOutput);

if (process.platform === 'linux') {
  process.stdout.write(
    `Checking representative watch mode with ${compilerName}.\n`,
  );
  let watchOutput = '';
  let watcherResult;
  let resolveWatcherExit;
  const watcherExit = new Promise(resolve => {
    resolveWatcherExit = resolve;
  });
  const watcher = spawn(
    compiler,
    [
      '--build',
      probeConfig,
      '--watch',
      '--pretty',
      'false',
      '--preserveWatchOutput',
    ],
    {
      cwd: workspaceRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  activeChildren.add(watcher);
  watcher.stdout.setEncoding('utf8');
  watcher.stderr.setEncoding('utf8');
  watcher.stdout.on('data', chunk => {
    watchOutput += chunk;
    process.stdout.write(chunk);
  });
  watcher.stderr.on('data', chunk => {
    watchOutput += chunk;
    process.stderr.write(chunk);
  });

  const settleWatcher = result => {
    if (watcherResult != null) return;
    watcherResult = result;
    activeChildren.delete(watcher);
    resolveWatcherExit(result);
  };
  watcher.once('error', error => settleWatcher({ error }));
  watcher.once('close', (code, signal) => settleWatcher({ code, signal }));

  const watchCycleCount = () =>
    watchOutput.match(/Watching for file changes\./g)?.length ?? 0;
  const assertWatcherRunning = () => {
    if (watcherResult == null) return;
    const result =
      watcherResult.error == null
        ? `code ${watcherResult.code}, signal ${watcherResult.signal}`
        : watcherResult.error.message;
    throw new FatalWatchError(
      `${compilerName} watch mode exited unexpectedly (${result}).\n${watchOutput.slice(-4_000)}`,
    );
  };

  try {
    await waitFor(`${compilerName} watch mode to become ready`, () => {
      assertWatcherRunning();
      return watchCycleCount() >= 1;
    });

    const changedCycle = watchCycleCount();
    await setProbe(true);
    await waitFor(
      `${compilerName} watch mode to emit a source change`,
      async () => {
        assertWatcherRunning();
        return (
          watchCycleCount() > changedCycle &&
          (await readProbeOutput()).includes(probeName)
        );
      },
    );

    const restoredCycle = watchCycleCount();
    await setProbe(false);
    await waitFor(
      `${compilerName} watch mode to emit a restored source`,
      async () => {
        assertWatcherRunning();
        return (
          watchCycleCount() > restoredCycle &&
          !(await readProbeOutput()).includes(probeName)
        );
      },
    );
  } finally {
    if (sourceIsModified) await setProbe(false);
    await stopWatcher(watcher, watcherExit);
    await build(probeConfig);
  }
} else {
  process.stdout.write(
    `Skipping watch mode on ${process.platform}; CI validates it on Linux.\n`,
  );
}

process.stdout.write(`${compilerName} lifecycle checks passed.\n`);
