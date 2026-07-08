import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAllExportsSource,
  createCompilerOptions,
} from './check.mjs';

test('generates a type query for every exported subpath', () => {
  const source = createAllExportsSource([
    {
      exportSpecifiers: ['example', 'example/internal'],
      packageJson: { name: 'example' },
    },
  ]);

  assert.match(source, /typeof import\("example"\)/);
  assert.match(source, /typeof import\("example\/internal"\)/);
  assert.match(source, /1 packages and 2 exported subpaths/);
});

test('makes skipLibCheck an explicit property of each compatibility tier', () => {
  assert.equal(
    createCompilerOptions({
      moduleResolution: 'Bundler',
      skipLibCheck: true,
    }).skipLibCheck,
    true,
  );
  assert.equal(
    createCompilerOptions({
      moduleResolution: 'NodeNext',
      skipLibCheck: false,
    }).skipLibCheck,
    false,
  );
});
