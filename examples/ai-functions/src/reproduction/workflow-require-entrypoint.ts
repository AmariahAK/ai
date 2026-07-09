import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseJSON } from '@ai-sdk/provider-utils';

const packageName = '@ai-sdk/workflow';
const packageVersion = '1.0.17';
const packageSpecifier = `${packageName}@${packageVersion}`;

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
  main: string;
  types: string;
  exports: {
    '.': {
      types: string;
      import: string;
      require: string;
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

async function main() {
  const tempDirectory = await mkdtemp(
    join(process.cwd(), '.tmp-workflow-require-entrypoint-'),
  );

  try {
    const packResult = await runSuccessfulCommand(
      'npm',
      ['pack', packageSpecifier, '--json', '--pack-destination', tempDirectory],
      { cwd: tempDirectory },
    );

    const packOutput = (await parseJSON({
      text: packResult.stdout,
    })) as NpmPackOutput;
    const packedPackage = packOutput[0];

    if (packedPackage == null) {
      throw new Error(
        `npm pack did not return package data for ${packageSpecifier}`,
      );
    }

    const packedFiles = packedPackage.files.map(file => file.path).sort();
    const tarballPath = join(tempDirectory, packedPackage.filename);
    const projectDirectory = join(tempDirectory, 'project');
    const scopedPackagesDirectory = join(
      projectDirectory,
      'node_modules',
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

    const packageJson = (await parseJSON({
      text: await readFile(
        join(workflowPackageDirectory, 'package.json'),
        'utf8',
      ),
    })) as WorkflowPackageJson;

    const hasImportTarget = packedFiles.includes('dist/index.mjs');
    const hasImportTypesTarget = packedFiles.includes('dist/index.d.mts');
    const hasRequireTarget = packedFiles.includes('dist/index.js');
    const hasTypesTarget = packedFiles.includes('dist/index.d.ts');

    console.log(
      `Packed ${packageSpecifier} tarball: ${packedPackage.filename}`,
    );
    console.log('Published files:');
    for (const file of packedFiles) {
      console.log(`- ${file}`);
    }
    console.log('Declared package entry points:');
    console.log(`- main: ${packageJson.main}`);
    console.log(`- types: ${packageJson.types}`);
    console.log(`- exports["."].types: ${packageJson.exports['.'].types}`);
    console.log(`- exports["."].import: ${packageJson.exports['.'].import}`);
    console.log(`- exports["."].require: ${packageJson.exports['.'].require}`);
    console.log('Entrypoint files present:');
    console.log(`- dist/index.mjs: ${hasImportTarget}`);
    console.log(`- dist/index.d.mts: ${hasImportTypesTarget}`);
    console.log(`- dist/index.js: ${hasRequireTarget}`);
    console.log(`- dist/index.d.ts: ${hasTypesTarget}`);

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
        `require('${packageName}');`,
        `console.log('require("${packageName}") succeeded');`,
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

    if (!hasImportTarget || !hasImportTypesTarget) {
      throw new Error(
        'Expected the published tarball to contain ESM import files, but one or more were missing.',
      );
    }

    if (importResolveResult.exitCode !== 0) {
      throw new Error(
        'Expected import resolution to succeed through the published ESM entrypoint.',
      );
    }

    if (hasRequireTarget || hasTypesTarget) {
      throw new Error(
        'Expected the published tarball to be missing the declared CommonJS or TypeScript entrypoint files.',
      );
    }

    if (requireResult.exitCode !== 0) {
      throw new Error(
        `Expected require("${packageName}") to succeed, but it failed because ${packageSpecifier} declares a CommonJS entrypoint that is not published.`,
      );
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

await main();
