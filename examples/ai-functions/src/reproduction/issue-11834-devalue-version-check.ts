import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Version = [number, number, number];

const fixedVersion: Version = [5, 6, 2];

function parseVersion(version: string): Version {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (match == null) {
    throw new Error(`Unable to parse semver version: ${version}`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

async function main() {
  const currentFile = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(
    path.dirname(currentFile),
    '../../../..',
  );
  const lockfilePath = path.join(repositoryRoot, 'pnpm-lock.yaml');
  const lockfile = await readFile(lockfilePath, 'utf8');

  const devalueVersions = Array.from(
    lockfile.matchAll(/^ {2}devalue@([^:\n]+):/gm),
    match => match[1],
  ).sort((left, right) =>
    compareVersions(parseVersion(left), parseVersion(right)),
  );

  if (devalueVersions.length === 0) {
    throw new Error('No devalue package versions were found in pnpm-lock.yaml.');
  }

  const vulnerableVersions = devalueVersions.filter(
    version => compareVersions(parseVersion(version), fixedVersion) < 0,
  );

  console.log(`Found devalue versions: ${devalueVersions.join(', ')}`);

  if (vulnerableVersions.length > 0) {
    throw new Error(
      `Issue #11834 reproduced: pnpm-lock.yaml still resolves vulnerable devalue versions before 5.6.2: ${vulnerableVersions.join(', ')}`,
    );
  }

  console.log(
    'Issue #11834 could not be reproduced in this worktree: all devalue versions are >= 5.6.2.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
