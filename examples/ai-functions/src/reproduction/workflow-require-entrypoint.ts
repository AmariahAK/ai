import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const packageName = '@ai-sdk/workflow';
const packageVersion = '1.0.17';

type PackFile = {
  path: string;
};

type PackEntry = {
  filename: string;
  files: PackFile[];
};

type WorkflowPackageJson = {
  main: string;
  types: string;
  exports: {
    '.': {
      import: string;
      require: string;
      types: string;
    };
  };
};

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error != null) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error == null || !('code' in error)) {
    return undefined;
  }

  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), 'ai-sdk-workflow-require-entrypoint-'),
  );

  try {
    const { stdout } = await runCommand(
      'npm',
      [
        'pack',
        `${packageName}@${packageVersion}`,
        '--json',
        '--pack-destination',
        tempDirectory,
      ],
      tempDirectory,
    );
    const [packEntry] = JSON.parse(stdout) as PackEntry[];

    if (packEntry == null) {
      throw new Error(`npm pack did not return metadata for ${packageName}`);
    }

    const tarballPath = path.join(tempDirectory, packEntry.filename);
    const distFiles = packEntry.files
      .map(file => file.path)
      .filter(filePath => filePath.startsWith('dist/'))
      .sort();

    await runCommand(
      'tar',
      ['-xzf', tarballPath, '-C', tempDirectory],
      tempDirectory,
    );

    const extractedPackageDirectory = path.join(tempDirectory, 'package');
    const packageJson = JSON.parse(
      await readFile(
        path.join(extractedPackageDirectory, 'package.json'),
        'utf8',
      ),
    ) as WorkflowPackageJson;

    const installedPackageDirectory = path.join(
      tempDirectory,
      'node_modules',
      '@ai-sdk',
      'workflow',
    );
    await mkdir(path.dirname(installedPackageDirectory), { recursive: true });
    await cp(extractedPackageDirectory, installedPackageDirectory, {
      recursive: true,
    });

    const requireTarget = path.join(
      installedPackageDirectory,
      packageJson.exports['.'].require,
    );
    const typesTarget = path.join(
      installedPackageDirectory,
      packageJson.exports['.'].types,
    );
    const importTarget = path.join(
      installedPackageDirectory,
      packageJson.exports['.'].import,
    );

    console.log(`${packageName}@${packageVersion} dist files:`);
    console.log(distFiles.map(filePath => `- ${filePath}`).join('\n'));
    console.log(`main: ${packageJson.main}`);
    console.log(`exports["."].require: ${packageJson.exports['.'].require}`);
    console.log(`exports["."].types: ${packageJson.exports['.'].types}`);
    console.log(`exports["."].import: ${packageJson.exports['.'].import}`);
    console.log(`require target exists: ${existsSync(requireTarget)}`);
    console.log(`types target exists: ${existsSync(typesTarget)}`);
    console.log(`import target exists: ${existsSync(importTarget)}`);

    const requireFromTempProject = createRequire(
      path.join(tempDirectory, 'repro.cjs'),
    );

    try {
      requireFromTempProject(packageName);
    } catch (error) {
      const message = getErrorMessage(error);

      console.error(
        `require("${packageName}") failed with ${getErrorCode(error)}:`,
      );
      console.error(message);

      if (
        getErrorCode(error) === 'MODULE_NOT_FOUND' &&
        message.includes(path.join('dist', 'index.js'))
      ) {
        console.error(
          'Reproduced: the CommonJS export points to a missing file.',
        );
        process.exitCode = 1;
        return;
      }

      throw error;
    }

    console.log('Could not reproduce: require() succeeded.');
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
