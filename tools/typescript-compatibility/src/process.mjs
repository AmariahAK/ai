import { spawn } from 'node:child_process';

export const run = async (
  command,
  args,
  { cwd, capture = false, env = process.env } = {},
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';

    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        stdout += chunk;
      });
      child.stderr.on('data', chunk => {
        stderr += chunk;
      });
    }

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const capturedOutput = `${stdout}\n${stderr}`.trim();
      const detail =
        capture && capturedOutput
          ? `\n${capturedOutput.slice(-10_000)}`
          : '';
      reject(
        new Error(`${command} ${args.join(' ')} exited with code ${code}.${detail}`),
      );
    });
  });

export const runPnpm = async (args, options) =>
  process.env.PNPM_EXECUTABLE == null
    ? run('corepack', ['pnpm', ...args], options)
    : run(process.env.PNPM_EXECUTABLE, args, options);
