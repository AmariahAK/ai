import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  name: string;
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

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function runCommand(command: string, args: Array<string>, cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });

  expect(
    result.status,
    [
      `Command failed: ${command} ${args.join(' ')}`,
      `stdout: ${result.stdout}`,
      `stderr: ${result.stderr}`,
    ].join('\n'),
  ).toBe(0);

  return result.stdout.trim();
}

function runPnpm(args: Array<string>, cwd: string) {
  if (process.env.npm_execpath != null) {
    return runCommand(
      process.execPath,
      [process.env.npm_execpath, ...args],
      cwd,
    );
  }

  return runCommand('pnpm', args, cwd);
}

function getBuiltFilePath(buildDirectory: string, entrypoint: string) {
  const normalizedEntrypoint = entrypoint.replace(/^\.\//, '');

  expect(
    normalizedEntrypoint.startsWith('dist/'),
    `Expected package entrypoint ${entrypoint} to point into dist/.`,
  ).toBe(true);

  return path.join(buildDirectory, normalizedEntrypoint.slice('dist/'.length));
}

function assertDefined<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined();

  if (value == null) {
    throw new Error(message);
  }

  return value;
}

describe('@ai-sdk/workflow package entrypoints', () => {
  it('emits files for declared import, require, and types entrypoints', async () => {
    const tempDirectory = await mkdtemp(
      path.join(tmpdir(), 'ai-sdk-workflow-entrypoints-'),
    );

    try {
      const packageJson = JSON.parse(
        await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
      ) as PackageJson;
      const rootExport = packageJson.exports?.['.'];
      const buildDirectory = path.join(tempDirectory, 'dist');

      runPnpm(
        [
          'exec',
          'tsup',
          '--tsconfig',
          'tsconfig.build.json',
          '--out-dir',
          buildDirectory,
          '--silent',
        ],
        packageRoot,
      );

      const declaredEntrypoints: Array<[string, string | undefined]> = [
        ['main', packageJson.main],
        ['types', packageJson.types],
        ['exports.import', rootExport?.import],
        ['exports.require', rootExport?.require],
        ['exports.types', rootExport?.types],
      ];

      for (const [name, entrypoint] of declaredEntrypoints) {
        const definedEntrypoint = assertDefined(
          entrypoint,
          `${name} should be declared.`,
        );

        expect(
          existsSync(getBuiltFilePath(buildDirectory, definedEntrypoint)),
          `${name} (${definedEntrypoint}) should be emitted by the package build.`,
        ).toBe(true);
      }

      const requireEntrypoint = assertDefined(
        rootExport?.require ?? packageJson.main,
        'CommonJS package entrypoint should be declared.',
      );
      const importEntrypoint = assertDefined(
        rootExport?.import,
        'ESM package entrypoint should be declared.',
      );

      const packageInstallDirectory = path.join(
        tempDirectory,
        'project/node_modules/@ai-sdk/workflow',
      );
      await mkdir(packageInstallDirectory, { recursive: true });
      await writeFile(
        path.join(packageInstallDirectory, 'package.json'),
        JSON.stringify(packageJson, null, 2),
      );
      await cp(buildDirectory, path.join(packageInstallDirectory, 'dist'), {
        recursive: true,
      });

      expect(
        runCommand(
          process.execPath,
          [
            '--input-type=commonjs',
            '--eval',
            `console.log(require.resolve('${packageJson.name}'));`,
          ],
          path.join(tempDirectory, 'project'),
        ),
      ).toBe(path.join(packageInstallDirectory, requireEntrypoint));

      expect(
        runCommand(
          process.execPath,
          [
            '--input-type=module',
            '--eval',
            `console.log(import.meta.resolve('${packageJson.name}'));`,
          ],
          path.join(tempDirectory, 'project'),
        ),
      ).toBe(
        pathToFileURL(path.join(packageInstallDirectory, importEntrypoint))
          .href,
      );
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }, 60_000);
});
