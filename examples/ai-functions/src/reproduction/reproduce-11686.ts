import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function main() {
  const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
  const args = [
    '-C',
    'packages/react',
    'exec',
    'vitest',
    '--config',
    'vitest.config.js',
    '--run',
    'src/use-chat.stale-closures.test.tsx',
  ];

  console.log(`Running: pnpm ${args.join(' ')}`);

  const result = spawnSync('pnpm', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error != null) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
