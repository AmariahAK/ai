import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseJSON } from '@ai-sdk/provider-utils';

const packageName = '@ai-sdk/workflow';

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type NpmPackOutput = Array<{
  filename: string;
  files: Array<{ path: string }>;
}>;

type WorkflowPackageJson = {
  name: string;
  version: string;
  type?: string;
  main: string;
  module?: string;
  types: string;
  exports: {
    '.': {
      types: string;
      import: string;
      require?: string;
      default?: string;
    };
  };
};

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });

    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    child.on('error', reject);

    child.on('close', exitCode => {
      resolve({
        exitCode: exitCode ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

async function runSuccessfulCommand(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<CommandResult> {
  const result = await runCommand(command, args, options);

  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        `Exit code: ${result.exitCode}`,
        `stdout:\n${result.stdout}`,
        `stderr:\n${result.stderr}`,
      ].join('\n'),
    );
  }

  return result;
}

async function symlinkDependency({
  dependencyName,
  sourceNodeModulesDirectory,
  targetNodeModulesDirectory,
}: {
  dependencyName: string;
  sourceNodeModulesDirectory: string;
  targetNodeModulesDirectory: string;
}) {
  const sourcePath = join(
    sourceNodeModulesDirectory,
    ...dependencyName.split('/'),
  );
  const targetPath = join(
    targetNodeModulesDirectory,
    ...dependencyName.split('/'),
  );

  await mkdir(dirname(targetPath), { recursive: true });
  await symlink(
    sourcePath,
    targetPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

async function main() {
  const repositoryRoot = join(process.cwd(), '..', '..');
  const workflowPackageSourceDirectory = join(
    repositoryRoot,
    'packages',
    'workflow',
  );
  const workflowPackageNodeModulesDirectory = join(
    workflowPackageSourceDirectory,
    'node_modules',
  );
  const tempDirectory = await mkdtemp(
    join(process.cwd(), '.tmp-workflow-require-entrypoint-'),
  );

  try {
    await runSuccessfulCommand('pnpm', ['--filter', packageName, 'build'], {
      cwd: repositoryRoot,
    });

    const packResult = await runSuccessfulCommand(
      'npm',
      [
        'pack',
        workflowPackageSourceDirectory,
        '--json',
        '--pack-destination',
        tempDirectory,
      ],
      { cwd: tempDirectory },
    );

    const packOutput = (await parseJSON({
      text: packResult.stdout,
    })) as NpmPackOutput;
    const packedPackage = packOutput[0];

    if (packedPackage == null) {
      throw new Error(
        `npm pack did not return package data for ${packageName}`,
      );
    }

    const packedFiles = packedPackage.files.map(file => file.path).sort();
    const tarballPath = join(tempDirectory, packedPackage.filename);
    const projectDirectory = join(tempDirectory, 'project');
    const projectNodeModulesDirectory = join(projectDirectory, 'node_modules');
    const scopedPackagesDirectory = join(
      projectNodeModulesDirectory,
      '@ai-sdk',
    );
    const workflowPackageDirectory = join(scopedPackagesDirectory, 'workflow');

    await mkdir(workflowPackageDirectory, { recursive: true });
    await runSuccessfulCommand(
      'tar',
      [
        '-xzf',
        tarballPath,
        '--strip-components=1',
        '-C',
        workflowPackageDirectory,
      ],
      { cwd: tempDirectory },
    );

    await Promise.all(
      [
        '@ai-sdk/provider',
        '@ai-sdk/provider-utils',
        'ai',
        'ajv',
        'workflow',
        'zod',
      ].map(dependencyName =>
        symlinkDependency({
          dependencyName,
          sourceNodeModulesDirectory: workflowPackageNodeModulesDirectory,
          targetNodeModulesDirectory: projectNodeModulesDirectory,
        }),
      ),
    );

    const packageJson = (await parseJSON({
      text: await readFile(
        join(workflowPackageDirectory, 'package.json'),
        'utf8',
      ),
    })) as WorkflowPackageJson;

    const hasImportTarget = packedFiles.includes('dist/index.js');
    const hasTypesTarget = packedFiles.includes('dist/index.d.ts');
    const hasStaleImportTarget = packedFiles.includes('dist/index.mjs');
    const hasStaleTypesTarget = packedFiles.includes('dist/index.d.mts');

    console.log(
      `Packed local ${packageJson.name}@${packageJson.version} tarball: ${packedPackage.filename}`,
    );
    console.log('Published files:');
    for (const file of packedFiles) {
      console.log(`- ${file}`);
    }
    console.log('Declared package entry points:');
    console.log(`- type: ${packageJson.type}`);
    console.log(`- main: ${packageJson.main}`);
    console.log(`- module: ${packageJson.module ?? '<absent>'}`);
    console.log(`- types: ${packageJson.types}`);
    console.log(`- exports["."].types: ${packageJson.exports['.'].types}`);
    console.log(`- exports["."].import: ${packageJson.exports['.'].import}`);
    console.log(
      `- exports["."].require: ${packageJson.exports['.'].require ?? '<absent>'}`,
    );
    console.log(
      `- exports["."].default: ${packageJson.exports['.'].default ?? '<absent>'}`,
    );
    console.log('Entrypoint files present:');
    console.log(`- dist/index.js: ${hasImportTarget}`);
    console.log(`- dist/index.d.ts: ${hasTypesTarget}`);
    console.log(`- dist/index.mjs: ${hasStaleImportTarget}`);
    console.log(`- dist/index.d.mts: ${hasStaleTypesTarget}`);

    const importResolveResult = await runCommand(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `console.log(import.meta.resolve('${packageName}'))`,
      ],
      { cwd: projectDirectory },
    );

    console.log('ESM import resolution probe:');
    console.log(`- exit code: ${importResolveResult.exitCode}`);
    console.log(`- stdout: ${importResolveResult.stdout.trim()}`);
    console.log(`- stderr: ${importResolveResult.stderr.trim()}`);

    const requireProbePath = join(projectDirectory, 'require-probe.cjs');
    await writeFile(
      requireProbePath,
      [
        `const workflow = require('${packageName}');`,
        `console.log(Object.keys(workflow).sort().join(','));`,
      ].join('\n'),
    );

    const requireResult = await runCommand(
      process.execPath,
      [requireProbePath],
      { cwd: projectDirectory },
    );

    console.log('CommonJS require probe:');
    console.log(`- exit code: ${requireResult.exitCode}`);
    console.log(`- stdout: ${requireResult.stdout.trim()}`);
    console.log(`- stderr: ${requireResult.stderr.trim()}`);

    if (packageJson.type !== 'module') {
      throw new Error(
        'Expected package.json to declare "type": "module" so tsup emits dist/index.js and dist/index.d.ts.',
      );
    }

    if (packageJson.module != null) {
      throw new Error(
        'Expected package.json not to declare a stale "module" entrypoint.',
      );
    }

    if (
      packageJson.main !== './dist/index.js' ||
      packageJson.types !== './dist/index.d.ts' ||
      packageJson.exports['.'].types !== './dist/index.d.ts' ||
      packageJson.exports['.'].import !== './dist/index.js' ||
      packageJson.exports['.'].default !== './dist/index.js' ||
      packageJson.exports['.'].require != null
    ) {
      throw new Error(
        'Expected package.json to point all public entrypoints at the published ESM build files.',
      );
    }

    if (!hasImportTarget || !hasTypesTarget) {
      throw new Error(
        'Expected the packed tarball to contain the declared JavaScript and TypeScript entrypoint files.',
      );
    }

    if (hasStaleImportTarget || hasStaleTypesTarget) {
      throw new Error(
        'Expected the packed tarball not to contain stale .mjs or .d.mts entrypoint files.',
      );
    }

    if (importResolveResult.exitCode !== 0) {
      throw new Error(
        'Expected import resolution to succeed through the published ESM entrypoint.',
      );
    }

    if (requireResult.exitCode !== 0) {
      throw new Error(
        `Expected require("${packageName}") to succeed from the packed package entrypoint.`,
      );
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

await main();
