import assert from 'node:assert/strict';
import test from 'node:test';

import { compareArtifactSnapshots } from './artifacts.mjs';

const snapshot = sha256 => ({
  schemaVersion: 1,
  packages: {
    ai: {
      artifacts: { 'dist/index.d.ts': { bytes: 10, sha256 } },
      exportSpecifiers: ['ai'],
      files: ['dist/index.d.ts', 'package.json'],
      publicMetadata: { name: 'ai', types: './dist/index.d.ts' },
    },
  },
});

test('accepts identical package artifacts', () => {
  assert.deepEqual(compareArtifactSnapshots(snapshot('same'), snapshot('same')), []);
});

test('reports changed package artifacts', () => {
  assert.deepEqual(compareArtifactSnapshots(snapshot('before'), snapshot('after')), [
    'ai: artifact changed: dist/index.d.ts',
  ]);
});

test('reports public metadata and tarball file-list changes', () => {
  const before = snapshot('same');
  const after = structuredClone(before);
  after.packages.ai.publicMetadata.types = './dist/public.d.ts';
  after.packages.ai.files.push('dist/public.d.ts');

  assert.deepEqual(compareArtifactSnapshots(before, after), [
    'ai: public package metadata changed',
    'ai: tarball file added: dist/public.d.ts',
  ]);
});
