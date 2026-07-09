import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPILER_MINIMUM_RELEASE_AGE_EXCLUDES,
  createAllExportsSource,
  createCompilerOptions,
  createConsumerWorkspace,
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

test('pins compiler fixtures and package overrides in workspace config', () => {
  const config = createConsumerWorkspace([
    {
      packageJson: { name: '@ai-sdk/example' },
      tarball: '/tmp/ai-sdk-example.tgz',
    },
  ]);

  assert.equal(
    config.overrides['@typescript/typescript6@6.0.2>@typescript/old'],
    'npm:typescript@6.0.2',
  );
  assert.equal(
    config.overrides['@ai-sdk/example'],
    'file:/tmp/ai-sdk-example.tgz',
  );
  assert.deepEqual(
    config.minimumReleaseAgeExclude,
    COMPILER_MINIMUM_RELEASE_AGE_EXCLUDES,
  );
  assert.equal(COMPILER_MINIMUM_RELEASE_AGE_EXCLUDES.length, 22);
});
