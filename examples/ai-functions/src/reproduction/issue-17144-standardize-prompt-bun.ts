import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ITERATIONS_PER_CONTENT_SHAPE = 100;
const ZOD_VERSIONS = ['3.25.76', '4.4.3'] as const;

const childSource = `
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

async function main() {
  const content =
    process.env.CONTENT_MODE === 'array'
      ? [{ type: 'text', text: 'hello' }]
      : 'hello';

  const model = createOpenAICompatible({
    baseURL: 'https://example.test/v1',
    name: 'reproduction',
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl-reproduction',
          object: 'chat.completion',
          created: 0,
          model: 'reproduction-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      ),
  })('reproduction-model');

  const result = await generateText({
    model,
    messages: [{ role: 'user', content }],
  });

  if (result.text !== 'ok') {
    throw new Error(\`Expected "ok", received \${JSON.stringify(result.text)}\`);
  }
}

main().catch(error => {
  console.error(
    JSON.stringify({
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
    }),
  );
  process.exitCode = 1;
});
`;

function runCommand({
  command,
  args,
  cwd,
  env,
}: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';

    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', exitCode => {
      resolve({ exitCode: exitCode ?? 1, output });
    });
  });
}

async function main() {
  const workspaceRoot = fileURLToPath(new URL('../../../..', import.meta.url));
  const tempRoot = await mkdtemp(join(workspaceRoot, '.issue-17144-'));
  const failures: Array<{
    zodVersion: string;
    contentMode: 'string' | 'array';
    output: string;
  }> = [];
  let completedCalls = 0;

  try {
    for (const zodVersion of ZOD_VERSIONS) {
      const scenarioDirectory = join(tempRoot, `zod-${zodVersion}`);
      await mkdir(scenarioDirectory);
      await writeFile(
        join(scenarioDirectory, 'package.json'),
        JSON.stringify({
          private: true,
          type: 'module',
          dependencies: {
            '@ai-sdk/openai-compatible': '2.0.45',
            ai: '6.0.174',
            bun: '1.3.14',
            zod: zodVersion,
          },
        }),
      );
      await writeFile(join(scenarioDirectory, 'child.ts'), childSource);

      const installResult = await runCommand({
        command: 'pnpm',
        args: [
          'install',
          '--ignore-workspace',
          '--no-frozen-lockfile',
          '--dir',
          scenarioDirectory,
        ],
        cwd: workspaceRoot,
      });
      if (installResult.exitCode !== 0) {
        throw new Error(
          `Dependency installation failed for zod@${zodVersion}:\n${installResult.output}`,
        );
      }

      const bunInstallResult = await runCommand({
        command: 'node',
        args: ['node_modules/bun/install.js'],
        cwd: scenarioDirectory,
      });
      if (bunInstallResult.exitCode !== 0) {
        throw new Error(
          `Bun installation failed for zod@${zodVersion}:\n${bunInstallResult.output}`,
        );
      }

      const bunBinary = join(scenarioDirectory, 'node_modules', '.bin', 'bun');

      for (const contentMode of ['string', 'array'] as const) {
        for (
          let iteration = 0;
          iteration < ITERATIONS_PER_CONTENT_SHAPE;
          iteration++
        ) {
          const result = await runCommand({
            command: bunBinary,
            args: ['run', 'child.ts'],
            cwd: scenarioDirectory,
            env: { CONTENT_MODE: contentMode },
          });
          completedCalls++;

          if (result.exitCode !== 0) {
            failures.push({
              zodVersion,
              contentMode,
              output: result.output,
            });
          }
        }
      }
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }

  if (failures.length > 0) {
    const firstFailure = failures[0];
    throw new Error(
      [
        `Valid messages failed in ${failures.length}/${completedCalls} fresh Bun processes.`,
        `First failure used zod@${firstFailure.zodVersion} with ${firstFailure.contentMode} content:`,
        firstFailure.output,
      ].join('\n'),
    );
  }

  console.log(
    `All ${completedCalls} valid generateText calls succeeded in fresh Bun 1.3.14 processes.`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
