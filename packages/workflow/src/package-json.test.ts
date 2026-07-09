import { readFile } from 'node:fs/promises';
import { parseJSON } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';

type WorkflowPackageJson = {
  type?: string;
  main?: string;
  module?: string;
  types?: string;
  exports?: {
    '.'?: {
      types?: string;
      import?: string;
      require?: string;
      default?: string;
    };
  };
};

describe('@ai-sdk/workflow package.json', () => {
  it('points package entrypoints at the files produced by the ESM build', async () => {
    const packageJson = (await parseJSON({
      text: await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    })) as WorkflowPackageJson;

    expect(packageJson.type).toBe('module');
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson).not.toHaveProperty('module');

    expect(packageJson.exports?.['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    });
  });
});
