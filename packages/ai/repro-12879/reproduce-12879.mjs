import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.join(tmpdir(), 'ai-issue-12879-repro');
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

console.log(`Creating isolated issue #12879 project in ${root}`);

writeFileSync(
  path.join(root, 'package.json'),
  JSON.stringify(
    {
      type: 'module',
      private: true,
      dependencies: {
        '@ai-sdk/openai': '3.0.34',
        ai: '6.0.101',
        zod: '4.1.12',
      },
      devDependencies: {
        '@types/json-schema': '7.0.15',
        '@types/node': '22.15.30',
        typescript: '5.8.3',
      },
    },
    null,
    2,
  ),
);

const install = spawnSync(
  'pnpm',
  ['install', '--ignore-workspace', '--lockfile=false'],
  {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  },
);

if (install.status !== 0) {
  console.error(install.stdout);
  console.error(install.stderr);
  throw new Error(`pnpm install failed with exit code ${install.status}`);
}

const sharedPrefix = `
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, tool, jsonSchema } from 'ai';
import z from 'zod';

export type ChatBotOutput = { messages: string[] };

class ProfileService {}
function buildSystemPrompt(_ctx: { name: string }) { return 'system'; }
function buildTools(_profileService: ProfileService) {
  return {
    loadProfile: tool({
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({ id, name: 'Ada' }),
    }),
  };
}
`;

writeFileSync(
  path.join(root, 'repro-zod-output.ts'),
  `${sharedPrefix}
export async function run() {
  const openai = createOpenAI({ apiKey: 'unused-for-typecheck' });
  const model = openai('gpt-4o');
  const profileService = new ProfileService();

  const schema = z.object({
    messages: z.array(z.string()).min(1).max(3),
  });

  const result = await generateText({
    model,
    system: buildSystemPrompt({ name: 'Ada' }),
    prompt: 'Generate the messages now.',
    tools: buildTools(profileService),
    output: Output.object({ schema }),
    maxRetries: 1,
  });

  return result.output.messages;
}
`,
);

writeFileSync(
  path.join(root, 'repro-json-schema-output.ts'),
  `${sharedPrefix}
export async function run() {
  const openai = createOpenAI({ apiKey: 'unused-for-typecheck' });
  const model = openai('gpt-4o');
  const profileService = new ProfileService();

  const result = await generateText({
    model,
    system: buildSystemPrompt({ name: 'Ada' }),
    prompt: 'Generate the messages now.',
    tools: buildTools(profileService),
    output: Output.object({
      schema: jsonSchema<ChatBotOutput>({
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 3,
          },
        },
        required: ['messages'],
      }),
    }),
    maxRetries: 1,
  });

  return result.output.messages;
}
`,
);

writeFileSync(
  path.join(root, 'repro-no-output.ts'),
  `${sharedPrefix}
export async function run() {
  const openai = createOpenAI({ apiKey: 'unused-for-typecheck' });
  const model = openai('gpt-4o');
  const profileService = new ProfileService();

  const result = await generateText({
    model,
    system: buildSystemPrompt({ name: 'Ada' }),
    prompt: 'Generate the messages now.',
    tools: buildTools(profileService),
    maxRetries: 1,
  });

  return result.text;
}
`,
);

function runTsc(file) {
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: false,
          skipLibCheck: false,
          noEmit: true,
          types: ['node'],
        },
        files: [file],
      },
      null,
      2,
    ),
  );

  const start = performance.now();
  const result = spawnSync(
    path.join(root, 'node_modules/.bin/tsc'),
    ['-p', 'tsconfig.json', '--extendedDiagnostics'],
    { cwd: root, encoding: 'utf8' },
  );
  const elapsedMs = Math.round(performance.now() - start);
  const output = result.stdout + result.stderr;
  const checkTimeSeconds = Number(
    output.match(/Check time:\s+([0-9.]+)s/)?.[1] ?? Number.NaN,
  );
  const instantiations = Number(
    output.match(/Instantiations:\s+(\d+)/)?.[1] ?? Number.NaN,
  );
  const memoryK = Number(output.match(/Memory used:\s+(\d+)K/)?.[1] ?? Number.NaN);

  console.log(
    JSON.stringify({
      file,
      exitCode: result.status,
      elapsedMs,
      checkTimeSeconds,
      instantiations,
      memoryK,
    }),
  );

  if (result.status !== 0) {
    console.error(output);
    throw new Error(`${file} failed to type-check`);
  }

  return { elapsedMs, checkTimeSeconds, instantiations, memoryK };
}

function readProcessCpuTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
    return Number(stat[13]) + Number(stat[14]);
  } catch {
    return 0;
  }
}

function sendTsserverRequest(child, seq, command, args = {}) {
  const message = JSON.stringify({
    seq,
    type: 'request',
    command,
    arguments: args,
  });
  child.stdin.write(
    `Content-Length: ${Buffer.byteLength(message, 'utf8')}\r\n\r\n${message}`,
  );
}

async function sampleTsserverCpu(file) {
  const fullPath = path.join(root, file);
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/typescript/lib/tsserver.js'),
      '--disableAutomaticTypingAcquisition',
    ],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  let stdoutBytes = 0;
  child.stdout.on('data', data => {
    stdoutBytes += data.length;
  });
  child.stderr.on('data', data => {
    process.stderr.write(data);
  });

  const startTicks = readProcessCpuTicks(child.pid);
  const start = performance.now();
  let seq = 0;

  sendTsserverRequest(child, ++seq, 'configure', {
    preferences: {},
    watchOptions: {},
  });
  sendTsserverRequest(child, ++seq, 'open', {
    file: fullPath,
    fileContent: readFileSync(fullPath, 'utf8'),
    projectRootPath: root,
  });

  setTimeout(() => {
    sendTsserverRequest(child, ++seq, 'semanticDiagnosticsSync', {
      file: fullPath,
    });
  }, 200);
  setTimeout(() => {
    sendTsserverRequest(child, ++seq, 'quickinfo', {
      file: fullPath,
      line: 32,
      offset: 13,
    });
  }, 400);
  setTimeout(() => {
    sendTsserverRequest(child, ++seq, 'completions', {
      file: fullPath,
      line: 32,
      offset: 13,
      includeExternalModuleExports: false,
      includeInsertTextCompletions: false,
    });
  }, 600);

  const samples = [];
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const elapsedSeconds = (performance.now() - start) / 1000;
    const cpuSeconds = (readProcessCpuTicks(child.pid) - startTicks) / 100;
    samples.push({
      elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
      cpuSeconds: Number(cpuSeconds.toFixed(2)),
      approximateCpuPercent: Number(((cpuSeconds / elapsedSeconds) * 100).toFixed(0)),
      stdoutBytes,
    });
  }

  child.kill('SIGTERM');
  await new Promise(resolve => child.once('close', resolve));

  console.log(JSON.stringify({ tsserverFile: file, samples }, null, 2));
  return samples.at(-1)?.approximateCpuPercent ?? 0;
}

console.log('Running TypeScript compiler checks with strict=false...');
const noOutput = runTsc('repro-no-output.ts');
const jsonOutput = runTsc('repro-json-schema-output.ts');
const zodOutput = runTsc('repro-zod-output.ts');

console.log('Sampling tsserver CPU on the Zod Output.object case...');
const finalCpuPercent = await sampleTsserverCpu('repro-zod-output.ts');

const zodVsNoOutputRatio = zodOutput.checkTimeSeconds / noOutput.checkTimeSeconds;
const zodVsJsonRatio = zodOutput.checkTimeSeconds / jsonOutput.checkTimeSeconds;

console.log(
  JSON.stringify({
    zodVsNoOutputCheckTimeRatio: Number(zodVsNoOutputRatio.toFixed(2)),
    zodVsJsonSchemaCheckTimeRatio: Number(zodVsJsonRatio.toFixed(2)),
    finalTsserverCpuPercent: finalCpuPercent,
  }),
);

if (
  zodOutput.checkTimeSeconds > 30 ||
  zodVsNoOutputRatio > 5 ||
  zodVsJsonRatio > 5 ||
  finalCpuPercent > 100
) {
  throw new Error(
    'Reproduced issue #12879: Zod structured output caused excessive TypeScript check time or tsserver CPU.',
  );
}

console.log(
  'Could not reproduce issue #12879 in this sandbox: Zod structured output type-checks and tsserver becomes idle.',
);
