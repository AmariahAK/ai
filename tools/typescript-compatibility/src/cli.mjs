#!/usr/bin/env node

import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareArtifactSnapshots,
  createArtifactSnapshot,
  writeArtifactSnapshot,
} from './artifacts.mjs';
import { checkPackedPackages, DEFAULT_COMPILERS } from './check.mjs';
import { packPackages } from './pack.mjs';
import { discoverPublishedPackages } from './packages.mjs';
import { runPnpm } from './process.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(toolRoot, '../..');

process.stdout.on('error', error => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

const usage = `Usage:
  node src/cli.mjs discover
  node src/cli.mjs check [--compiler LABEL=/path/to/tsc] [--keep] [--skip-build]
  node src/cli.mjs snapshot --output /outside/repo/snapshot.json [--keep] [--skip-build]
  node src/cli.mjs compare --baseline /outside/repo/snapshot.json [--keep] [--skip-build]
`;

const prependCorepackShim = async workDir => {
  const binDirectory = path.join(workDir, 'bin');
  const executable = path.join(binDirectory, 'pnpm');
  await mkdir(binDirectory, { recursive: true });
  await writeFile(
    executable,
    `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const result = spawnSync('corepack', ['pnpm', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
`,
  );
  await chmod(executable, 0o755);
  process.env.PATH = `${binDirectory}${path.delimiter}${process.env.PATH}`;
};

const parseArguments = arguments_ => {
  const options = {
    command: arguments_[0],
    compilers: [],
    keep: false,
    skipBuild: false,
  };

  for (let index = 1; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === '--keep') {
      options.keep = true;
    } else if (argument === '--skip-build') {
      options.skipBuild = true;
    } else if (['--baseline', '--output'].includes(argument)) {
      options[argument.slice(2)] = arguments_[++index];
    } else if (argument === '--compiler') {
      const value = arguments_[++index];
      const separator = value?.indexOf('=') ?? -1;
      if (separator < 1 || separator === value.length - 1) {
        throw new Error('--compiler must be LABEL=/absolute/path/to/tsc.');
      }
      const executable = value.slice(separator + 1);
      if (!path.isAbsolute(executable)) {
        throw new Error('--compiler requires an absolute compiler path.');
      }
      options.compilers.push({
        executable,
        label: value.slice(0, separator),
      });
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (!['check', 'compare', 'discover', 'snapshot'].includes(options.command)) {
    process.stderr.write(usage);
    process.exitCode = 1;
    return;
  }

  const packages = await discoverPublishedPackages(workspaceRoot);
  const rootPackageJson = JSON.parse(
    await readFile(path.join(workspaceRoot, 'package.json'), 'utf8'),
  );
  const exportCount = packages.reduce(
    (total, workspacePackage) =>
      total + workspacePackage.exportSpecifiers.length,
    0,
  );

  if (options.command === 'discover') {
    process.stdout.write(
      `${packages.length} published packages, ${exportCount} exported subpaths\n`,
    );
    for (const workspacePackage of packages) {
      const exports = workspacePackage.exportSpecifiers.join(', ') || '(no exports)';
      process.stdout.write(`${workspacePackage.packageJson.name}: ${exports}\n`);
    }
    return;
  }

  if (options.command === 'snapshot' && options.output == null) {
    throw new Error('snapshot requires --output.');
  }
  if (options.command === 'compare' && options.baseline == null) {
    throw new Error('compare requires --baseline.');
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'ai-sdk-ts-compat-'));
  process.stdout.write(`Working directory: ${workDir}\n`);

  try {
    await prependCorepackShim(workDir);

    if (!options.skipBuild) {
      process.stdout.write('Building clean package artifacts\n');
      await runPnpm(['build:packages'], { cwd: workspaceRoot });
    }

    const tarballs = await packPackages({
      destination: path.join(workDir, 'tarballs'),
      packages,
    });

    if (options.command === 'check') {
      await checkPackedPackages({
        compilers:
          options.compilers.length > 0 ? options.compilers : DEFAULT_COMPILERS,
        consumerDir: path.join(workDir, 'consumer'),
        fixtureFile: path.join(toolRoot, 'fixtures', 'representative-api.ts'),
        packageManager: rootPackageJson.packageManager,
        packages: packages.map(workspacePackage => ({
          ...workspacePackage,
          tarball: tarballs.get(workspacePackage.packageJson.name),
        })),
      });
      return;
    }

    const snapshot = await createArtifactSnapshot({ packages, tarballs, workDir });
    if (options.command === 'snapshot') {
      await writeArtifactSnapshot(path.resolve(options.output), snapshot);
      process.stdout.write(`Wrote ${path.resolve(options.output)}\n`);
      return;
    }

    const baseline = JSON.parse(
      await readFile(path.resolve(options.baseline), 'utf8'),
    );
    const differences = compareArtifactSnapshots(baseline, snapshot);
    if (differences.length > 0) {
      process.stderr.write(`${differences.join('\n')}\n`);
      throw new Error(`${differences.length} artifact difference(s) found.`);
    }
    process.stdout.write('Packed package artifacts match the baseline.\n');
  } finally {
    if (options.keep) {
      process.stdout.write(`Kept ${workDir}\n`);
    } else {
      await rm(workDir, { force: true, recursive: true });
    }
  }
};

main().catch(error => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
