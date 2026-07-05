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
    'src/use-chat.ui.test.tsx',
    '-t',
    'should automatically reconnect when tab becomes visible after a dropped stream',
  ];

  console.log(`Running: pnpm ${args.join(' ')}`);

  const result = spawnSync('pnpm', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
