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

const orderInsensitiveMetadataCases = [
  [
    'dependencies',
    { zod: '4.0.0', '@ai-sdk/provider': '1.0.0' },
    { '@ai-sdk/provider': '1.0.0', zod: '4.0.0' },
  ],
  [
    'peerDependencies',
    { zod: '^4.0.0', react: '^19.0.0' },
    { react: '^19.0.0', zod: '^4.0.0' },
  ],
  [
    'peerDependenciesMeta',
    { zod: { optional: true }, react: { optional: true } },
    { react: { optional: true }, zod: { optional: true } },
  ],
  [
    'optionalDependencies',
    { sharp: '1.0.0', canvas: '2.0.0' },
    { canvas: '2.0.0', sharp: '1.0.0' },
  ],
];

for (const [field, beforeValue, afterValue] of orderInsensitiveMetadataCases) {
  test(`ignores ${field} key order in public metadata`, () => {
    const before = snapshot('same');
    before.packages.ai.publicMetadata[field] = beforeValue;

    const after = snapshot('same');
    after.packages.ai.publicMetadata[field] = afterValue;

    assert.deepEqual(compareArtifactSnapshots(before, after), []);
  });
}

const orderSensitiveMetadataCases = [
  [
    'exports',
    { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
  ],
  [
    'imports',
    { '#first': './first.js', '#second': './second.js' },
    { '#second': './second.js', '#first': './first.js' },
  ],
  ['files', ['dist', 'README.md'], ['README.md', 'dist']],
];

for (const [field, beforeValue, afterValue] of orderSensitiveMetadataCases) {
  test(`preserves order-sensitive ${field} metadata comparisons`, () => {
    const before = snapshot('same');
    before.packages.ai.publicMetadata[field] = beforeValue;

    const after = snapshot('same');
    after.packages.ai.publicMetadata[field] = afterValue;

    assert.deepEqual(compareArtifactSnapshots(before, after), [
      'ai: public package metadata changed',
    ]);
  });
}
