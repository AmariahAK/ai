import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

type PackageJson = {
  version?: string;
  main?: string;
  types?: string;
  exports?: {
    '.'?: {
      types?: string;
      import?: string;
      require?: string;
    };
  };
};

type PackOutput = Array<{
  filename: string;
  files: Array<{ path: string }>;
  version?: string;
}>;

function isPresent(value: string | undefined): value is string {
  return value != null;
}

function runCommand(command: string, args: Array<string>, cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        `stdout: ${result.stdout}`,
        `stderr: ${result.stderr}`,
      ].join('\n'),
    );
  }

  return result;
}

async function main() {
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), 'ai-sdk-workflow-entrypoint-'),
  );

  let reproduced = false;

  try {
    const packResult = runCommand(
      'npm',
      [
        'pack',
        '@ai-sdk/workflow@1.0.17',
        '--json',
        '--pack-destination',
        tempDirectory,
      ],
      tempDirectory,
    );
    const packedPackage = (JSON.parse(packResult.stdout) as PackOutput)[0];

    if (packedPackage == null) {
      throw new Error('npm pack did not return package metadata.');
    }

    const extractDirectory = path.join(tempDirectory, 'extract');
    await mkdir(extractDirectory);
    runCommand(
      'tar',
      [
        '-xzf',
        path.join(tempDirectory, packedPackage.filename),
        '-C',
        extractDirectory,
      ],
      tempDirectory,
    );

    const workflowPackageDirectory = path.join(extractDirectory, 'package');
    const packageJson = JSON.parse(
      await readFile(
        path.join(workflowPackageDirectory, 'package.json'),
        'utf8',
      ),
    ) as PackageJson;
    const rootExport = packageJson.exports?.['.'];

    const declaredCommonJsAndTypesFiles = [
      packageJson.main,
      packageJson.types,
      rootExport?.require,
      rootExport?.types,
    ].filter(isPresent);

    const missingDeclaredFiles = declaredCommonJsAndTypesFiles.filter(
      file => !existsSync(path.join(workflowPackageDirectory, file)),
    );

    const importTargetExists =
      rootExport?.import != null &&
      existsSync(path.join(workflowPackageDirectory, rootExport.import));

    console.log(
      JSON.stringify(
        {
          package: '@ai-sdk/workflow',
          version: packageJson.version,
          tarballFiles: packedPackage.files.map(file => file.path),
          declaredCommonJsAndTypesFiles,
          missingDeclaredFiles,
          importTarget: rootExport?.import,
          importTargetExists,
        },
        null,
        2,
      ),
    );

    if (missingDeclaredFiles.length === 0) {
      throw new Error('Issue did not reproduce: all declared files exist.');
    }

    if (!importTargetExists) {
      throw new Error('Issue did not reproduce: import target is missing.');
    }

    const tempProject = path.join(tempDirectory, 'project');
    await mkdir(path.join(tempProject, 'node_modules/@ai-sdk'), {
      recursive: true,
    });
    await symlink(
      workflowPackageDirectory,
      path.join(tempProject, 'node_modules/@ai-sdk/workflow'),
      'dir',
    );

    const importResult = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "console.log(import.meta.resolve('@ai-sdk/workflow'));",
      ],
      {
        cwd: tempProject,
        encoding: 'utf8',
      },
    );

    const requireResult = spawnSync(
      process.execPath,
      [
        '--input-type=commonjs',
        '--eval',
        "console.log(require.resolve('@ai-sdk/workflow'));",
      ],
      {
        cwd: tempProject,
        encoding: 'utf8',
      },
    );

    console.log('import stdout:', importResult.stdout.trim());
    console.log('import stderr:', importResult.stderr.trim());
    console.log('import status:', importResult.status);
    console.log('require stdout:', requireResult.stdout.trim());
    console.log('require stderr:', requireResult.stderr.trim());
    console.log('require status:', requireResult.status);

    if (importResult.status !== 0) {
      throw new Error('Issue did not reproduce: import resolution failed.');
    }

    if (
      requireResult.status === 0 ||
      !requireResult.stderr.includes('MODULE_NOT_FOUND') ||
      !requireResult.stderr.includes('dist/index.js')
    ) {
      throw new Error(
        "Issue did not reproduce: require('@ai-sdk/workflow') did not fail with MODULE_NOT_FOUND for dist/index.js.",
      );
    }

    reproduced = true;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }

  if (reproduced) {
    console.error(
      "Reproduced issue #16925: require.resolve('@ai-sdk/workflow') resolves the package's require export to missing dist/index.js and fails with MODULE_NOT_FOUND.",
    );
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
