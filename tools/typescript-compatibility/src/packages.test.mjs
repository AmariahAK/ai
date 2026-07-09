import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getExportSpecifiers,
  removePackageDistDirectories,
} from './packages.mjs';

test('turns package export keys into consumer specifiers', () => {
  assert.deepEqual(
    getExportSpecifiers({
      name: '@ai-sdk/example',
      exports: {
        '.': { types: './dist/index.d.ts' },
        './internal': { types: './dist/internal.d.ts' },
        './package.json': './package.json',
      },
    }),
    [
      '@ai-sdk/example',
      '@ai-sdk/example/internal',
      '@ai-sdk/example/package.json',
    ],
  );
});

test('treats a conditional root export as the package root', () => {
  assert.deepEqual(
    getExportSpecifiers({
      name: 'example',
      exports: { types: './dist/index.d.ts', import: './dist/index.js' },
    }),
    ['example'],
  );
});

test('requires explicit handling for wildcard exports', () => {
  assert.throws(
    () =>
      getExportSpecifiers({
        name: 'example',
        exports: { './*': './dist/*.js' },
      }),
    /wildcard export/,
  );
});

test('removes only the top-level dist directory from discovered packages', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ts-compat-packages-'));
  t.after(() => rm(root, { force: true, recursive: true }));

  const packageDirectory = path.join(root, 'example');
  await mkdir(path.join(packageDirectory, 'dist', 'nested'), {
    recursive: true,
  });
  await writeFile(
    path.join(packageDirectory, 'dist', 'nested', 'stale.js'),
    '',
  );
  await writeFile(path.join(packageDirectory, 'keep.txt'), 'keep');

  await removePackageDistDirectories([{ directory: packageDirectory }]);

  await assert.rejects(access(path.join(packageDirectory, 'dist')), {
    code: 'ENOENT',
  });
  assert.equal(
    await readFile(path.join(packageDirectory, 'keep.txt'), 'utf8'),
    'keep',
  );
});
