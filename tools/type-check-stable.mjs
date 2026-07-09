import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// TypeScript 6 rejects --stableTypeOrdering with --build. The root scripts
// first build the graph normally, then this checks every referenced project.
const require = createRequire(import.meta.url);
const ts = require('typescript');

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const rootConfig = path.resolve(
  workspaceRoot,
  process.argv[2] ?? 'tsconfig.json',
);
const concurrency = Number(process.env.TYPE_CHECK_CONCURRENCY ?? '4');

if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
  throw new Error('TYPE_CHECK_CONCURRENCY must be a positive integer.');
}

const typescriptPackagePath = require.resolve('typescript/package.json');
const typescriptPackage = JSON.parse(
  readFileSync(typescriptPackagePath, 'utf8'),
);
const bin =
  typeof typescriptPackage.bin === 'string'
    ? typescriptPackage.bin
    : (typescriptPackage.bin?.tsc ??
      typescriptPackage.bin?.tsc6 ??
      Object.values(typescriptPackage.bin ?? {})[0]);

if (bin == null) {
  throw new Error('The installed TypeScript package has no compiler binary.');
}

const compiler = path.resolve(path.dirname(typescriptPackagePath), bin);
const parseHost = {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: diagnostic => {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  },
};

const resolveConfig = candidate => {
  const resolved = path.resolve(candidate);
  return statSync(resolved).isDirectory()
    ? path.join(resolved, 'tsconfig.json')
    : resolved;
};

const projects = [];
const visited = new Set();

const visit = configFile => {
  const resolved = resolveConfig(configFile);
  if (visited.has(resolved)) return;
  visited.add(resolved);

  const parsed = ts.getParsedCommandLineOfConfigFile(resolved, {}, parseHost);
  if (parsed == null) {
    throw new Error(`Could not parse ${path.relative(workspaceRoot, resolved)}.`);
  }

  for (const reference of parsed.projectReferences ?? []) {
    visit(ts.resolveProjectReferencePath(reference));
  }

  if (parsed.fileNames.length > 0) {
    projects.push(resolved);
  }
};

visit(rootConfig);

const runProject = configFile =>
  new Promise((resolve, reject) => {
    const relative = path.relative(workspaceRoot, configFile);
    const child = spawn(
      process.execPath,
      [
        compiler,
        '--project',
        configFile,
        '--noEmit',
        '--stableTypeOrdering',
        '--incremental',
        'false',
        '--composite',
        'false',
        '--pretty',
        'false',
      ],
      { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${relative}\n${output.trim()}`));
      }
    });
  });

process.stdout.write(
  `Checking ${projects.length} projects with TypeScript ${typescriptPackage.version}, stable type ordering, and ${concurrency} workers.\n`,
);

let nextProject = 0;
const failures = [];

await Promise.all(
  Array.from({ length: Math.min(concurrency, projects.length) }, async () => {
    while (nextProject < projects.length) {
      const project = projects[nextProject++];
      try {
        await runProject(project);
      } catch (error) {
        failures.push(error);
      }
    }
  }),
);

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`${failure.message}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write('Stable type-ordering checks passed.\n');
}
