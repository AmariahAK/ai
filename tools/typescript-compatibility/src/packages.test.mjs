import assert from 'node:assert/strict';
import test from 'node:test';

import { getExportSpecifiers } from './packages.mjs';

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
