import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { readJson } from './packages.mjs';
import { run } from './process.mjs';

const PUBLIC_METADATA_FIELDS = [
  'name',
  'version',
  'type',
  'main',
  'module',
  'types',
  'typings',
  'browser',
  'exports',
  'imports',
  'bin',
  'files',
  'sideEffects',
  'svelte',
  'react-native',
  'typesVersions',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'engines',
];

const ORDER_INSENSITIVE_METADATA_FIELDS = new Set([
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
]);

const isComparedArtifact = file =>
  /(?:\.d\.(?:ts|mts|cts)|\.(?:js|mjs|cjs)|\.map)$/.test(file);

const sha256 = value => createHash('sha256').update(value).digest('hex');

const selectPublicMetadata = packageJson =>
  Object.fromEntries(
    PUBLIC_METADATA_FIELDS.filter(field => packageJson[field] !== undefined).map(
      field => [field, packageJson[field]],
    ),
  );

const walkFiles = async (directory, prefix = '') => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolute, relative)));
    } else {
      files.push(relative);
    }
  }

  return files;
};

const snapshotExtractedPackage = async packageDirectory => {
  const files = await walkFiles(packageDirectory);
  const artifacts = {};

  for (const file of files) {
    if (!isComparedArtifact(file)) {
      continue;
    }

    const absolute = path.join(packageDirectory, file);
    const stats = await lstat(absolute);
    const content = stats.isSymbolicLink()
      ? Buffer.from(await readlink(absolute))
      : await readFile(absolute);

    artifacts[file] = {
      bytes: content.byteLength,
      sha256: sha256(content),
    };
  }

  const packageJson = await readJson(path.join(packageDirectory, 'package.json'));

  return {
    artifacts,
    files,
    publicMetadata: selectPublicMetadata(packageJson),
  };
};

export const createArtifactSnapshot = async ({ packages, tarballs, workDir }) => {
  const extractionRoot = path.join(workDir, 'extracted');
  await rm(extractionRoot, { force: true, recursive: true });
  await mkdir(extractionRoot, { recursive: true });
  const snapshots = {};

  for (const workspacePackage of packages) {
    const name = workspacePackage.packageJson.name;
    const destination = path.join(
      extractionRoot,
      name.replaceAll('/', '__').replaceAll('@', ''),
    );
    await mkdir(destination, { recursive: true });
    await run('tar', ['-xzf', tarballs.get(name), '-C', destination]);

    snapshots[name] = {
      exportSpecifiers: workspacePackage.exportSpecifiers,
      ...(await snapshotExtractedPackage(path.join(destination, 'package'))),
    };
  }

  return { schemaVersion: 1, packages: snapshots };
};

export const writeArtifactSnapshot = async (file, snapshot) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`);
};

const jsonEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const sortObjectKeys = value => {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (value == null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortObjectKeys(value[key])]),
  );
};

const normalizePublicMetadata = metadata =>
  Object.fromEntries(
    Object.entries(metadata).map(([field, value]) => [
      field,
      ORDER_INSENSITIVE_METADATA_FIELDS.has(field)
        ? sortObjectKeys(value)
        : value,
    ]),
  );

export const compareArtifactSnapshots = (baseline, candidate) => {
  if (baseline.schemaVersion !== candidate.schemaVersion) {
    return [
      `Snapshot schema changed from ${baseline.schemaVersion} to ${candidate.schemaVersion}.`,
    ];
  }

  const differences = [];
  const packageNames = new Set([
    ...Object.keys(baseline.packages),
    ...Object.keys(candidate.packages),
  ]);

  for (const name of [...packageNames].sort()) {
    const before = baseline.packages[name];
    const after = candidate.packages[name];

    if (before == null) {
      differences.push(`${name}: package added`);
      continue;
    }
    if (after == null) {
      differences.push(`${name}: package removed`);
      continue;
    }

    if (
      !jsonEqual(
        normalizePublicMetadata(before.publicMetadata),
        normalizePublicMetadata(after.publicMetadata),
      )
    ) {
      differences.push(`${name}: public package metadata changed`);
    }
    if (!jsonEqual(before.exportSpecifiers, after.exportSpecifiers)) {
      differences.push(`${name}: exported subpaths changed`);
    }

    const beforeFiles = new Set(before.files);
    const afterFiles = new Set(after.files);
    for (const file of beforeFiles) {
      if (!afterFiles.has(file)) {
        differences.push(`${name}: tarball file removed: ${file}`);
      }
    }
    for (const file of afterFiles) {
      if (!beforeFiles.has(file)) {
        differences.push(`${name}: tarball file added: ${file}`);
      }
    }

    const artifactPaths = new Set([
      ...Object.keys(before.artifacts),
      ...Object.keys(after.artifacts),
    ]);
    for (const artifact of [...artifactPaths].sort()) {
      if (before.artifacts[artifact] == null) {
        differences.push(`${name}: artifact added: ${artifact}`);
      } else if (after.artifacts[artifact] == null) {
        differences.push(`${name}: artifact removed: ${artifact}`);
      } else if (!jsonEqual(before.artifacts[artifact], after.artifacts[artifact])) {
        differences.push(`${name}: artifact changed: ${artifact}`);
      }
    }
  }

  return differences;
};
