import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { runPnpm } from './process.mjs';

const listTarballs = async directory =>
  new Set((await readdir(directory)).filter(file => file.endsWith('.tgz')));

export const packPackages = async ({ packages, destination }) => {
  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });

  const tarballs = new Map();

  for (const workspacePackage of packages) {
    const before = await listTarballs(destination);
    const name = workspacePackage.packageJson.name;
    process.stdout.write(`Packing ${name}\n`);
    await runPnpm(['pack', '--pack-destination', destination], {
      capture: true,
      cwd: workspacePackage.directory,
    });

    const after = await listTarballs(destination);
    const added = [...after].filter(file => !before.has(file));

    if (added.length !== 1) {
      throw new Error(
        `Expected ${name} to produce one new tarball, found ${added.length}.`,
      );
    }

    tarballs.set(name, path.join(destination, added[0]));
  }

  return tarballs;
};
