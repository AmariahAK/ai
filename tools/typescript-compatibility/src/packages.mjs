import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

export const getExportSpecifiers = packageJson => {
  const exports = packageJson.exports;

  if (exports == null) {
    return [];
  }

  if (typeof exports === 'string' || Array.isArray(exports)) {
    return [packageJson.name];
  }

  const keys = Object.keys(exports);
  const subpathKeys = keys.filter(key => key.startsWith('.'));

  if (subpathKeys.length === 0) {
    return [packageJson.name];
  }

  return subpathKeys.map(key => {
    if (key.includes('*')) {
      throw new Error(
        `${packageJson.name} has wildcard export ${key}; add expansion support before publishing it.`,
      );
    }

    return key === '.'
      ? packageJson.name
      : `${packageJson.name}/${key.slice(2)}`;
  });
};

export const discoverPublishedPackages = async workspaceRoot => {
  const packagesDirectory = path.join(workspaceRoot, 'packages');
  const directories = await readdir(packagesDirectory, { withFileTypes: true });
  const packages = [];

  for (const directory of directories) {
    if (!directory.isDirectory()) {
      continue;
    }

    const packageDirectory = path.join(packagesDirectory, directory.name);
    let packageJson;

    try {
      packageJson = await readJson(path.join(packageDirectory, 'package.json'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    if (packageJson.private === true) {
      continue;
    }

    if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
      throw new Error(`${packageDirectory}/package.json has no package name.`);
    }

    packages.push({
      directory: packageDirectory,
      exportSpecifiers: getExportSpecifiers(packageJson),
      packageJson,
    });
  }

  return packages.sort((left, right) =>
    left.packageJson.name.localeCompare(right.packageJson.name),
  );
};
