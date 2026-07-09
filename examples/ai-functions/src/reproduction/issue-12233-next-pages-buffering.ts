import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createGunzip } from 'node:zlib';

type ChunkTiming = {
  dt: number;
  length: number;
  text: string;
};

type ProbeResult = {
  headers: IncomingHttpHeaders;
  decodedChunks: ChunkTiming[];
  rawChunks: Omit<ChunkTiming, 'text'>[];
  eventTimes: number[];
  spanMs: number;
};

const host = '127.0.0.1';
const eventCount = 5;
const eventDelayMs = 200;

async function main() {
  const exampleRoot = process.cwd();
  const repoRoot = resolve(exampleRoot, '..', '..');
  const aiDistIndex = join(repoRoot, 'packages', 'ai', 'dist', 'index.js');
  const appDir = join(exampleRoot, '.reproduction', 'issue-12233-next13');

  await createNextApp({ appDir, aiDistIndex });
  await ensureNextDependencies(appDir);

  const port = await getFreePort();
  const logFile = join(appDir, 'next-dev.log');
  const next = startNextDev({ appDir, port, logFile });

  try {
    await waitForNext({ port, logFile });

    const sdk = await probeEndpoint({ port, path: '/api/sdk' });
    const workaround = await probeEndpoint({ port, path: '/api/workaround' });

    printProbeSummary({ sdk, workaround, port });

    if (!isIncremental(workaround)) {
      throw new Error(
        [
          'Setup blocker: the manual workaround endpoint did not stream incrementally.',
          `Expected workaround event span >= 400ms, observed ${workaround.spanMs}ms.`,
          `Next.js log: ${logFile}`,
        ].join('\n'),
      );
    }

    if (!isIncremental(sdk)) {
      throw new Error(
        [
          'Reproduced issue #12233: pipeUIMessageStreamToResponse was buffered by Next.js Pages Router.',
          `Expected SDK SSE events to arrive incrementally, but all decoded events arrived over ${sdk.spanMs}ms.`,
          `The SDK response was ${sdk.headers['content-encoding'] ?? 'not'} encoded.`,
          `Next.js log: ${logFile}`,
        ].join('\n'),
      );
    }
  } finally {
    await stopProcess(next);
  }
}

async function createNextApp({
  appDir,
  aiDistIndex,
}: {
  appDir: string;
  aiDistIndex: string;
}) {
  await rm(appDir, { recursive: true, force: true });
  await mkdir(join(appDir, 'pages', 'api'), { recursive: true });

  await writeFile(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        scripts: {
          dev: 'next dev',
        },
        dependencies: {
          next: '13.0.5',
          react: '18.2.0',
          'react-dom': '18.2.0',
        },
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(
    join(appDir, 'pages', 'index.js'),
    "export default function Home() { return 'ok'; }\n",
  );

  await writeFile(
    join(appDir, 'pages', 'api', 'sdk.js'),
    `import { pipeUIMessageStreamToResponse } from ${JSON.stringify(
      aiDistIndex,
    )};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeStream() {
  return new ReadableStream({
    async start(controller) {
      for (let i = 0; i < ${eventCount}; i++) {
        await delay(i === 0 ? 0 : ${eventDelayMs});
        controller.enqueue({ type: 'data-test', data: { i } });
      }
      controller.close();
    },
  });
}

export default function handler(req, res) {
  pipeUIMessageStreamToResponse({ response: res, stream: makeStream() });
}
`,
  );

  await writeFile(
    join(appDir, 'pages', 'api', 'workaround.js'),
    `function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeStream() {
  return new ReadableStream({
    async start(controller) {
      for (let i = 0; i < ${eventCount}; i++) {
        await delay(i === 0 ? 0 : ${eventDelayMs});
        controller.enqueue({ type: 'data-test', data: { i } });
      }
      controller.close();
    },
  });
}

export default async function handler(req, res) {
  res.socket?.setNoDelay(true);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Content-Encoding', 'none');
  res.flushHeaders();

  const reader = makeStream()
    .pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(\`data: \${JSON.stringify(chunk)}\\n\\n\`);
        },
      }),
    )
    .getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.write('data: [DONE]\\n\\n');
  res.end();
}
`,
  );
}

async function ensureNextDependencies(appDir: string) {
  const nextPackageJson = join(appDir, 'node_modules', 'next', 'package.json');
  if (existsSync(nextPackageJson)) {
    const installedNext = JSON.parse(
      await readFile(nextPackageJson, 'utf8'),
    ) as {
      version?: string;
    };
    if (installedNext.version === '13.0.5') return;
  }

  await runCommand({
    command: 'pnpm',
    args: ['install', '--ignore-workspace', '--no-frozen-lockfile'],
    cwd: appDir,
  });
}

function startNextDev({
  appDir,
  port,
  logFile,
}: {
  appDir: string;
  port: number;
  logFile: string;
}) {
  const nextBin = join(
    appDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'next.cmd' : 'next',
  );

  const child = spawn(
    nextBin,
    ['dev', '--hostname', host, '--port', String(port)],
    {
      cwd: appDir,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const logChunks: string[] = [];
  const appendLog = (chunk: Buffer) => {
    logChunks.push(chunk.toString());
    void writeFile(logFile, logChunks.join(''));
  };

  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);

  return child;
}

async function waitForNext({
  port,
  logFile,
}: {
  port: number;
  logFile: string;
}) {
  const startedAt = performance.now();

  while (performance.now() - startedAt < 60_000) {
    try {
      await requestPath({ port, path: '/' });
      return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for Next.js dev server. Log: ${logFile}`);
}

async function probeEndpoint({
  port,
  path,
}: {
  port: number;
  path: string;
}): Promise<ProbeResult> {
  const startedAt = performance.now();
  const rawChunks: Omit<ChunkTiming, 'text'>[] = [];
  const decodedChunks: ChunkTiming[] = [];

  const headers = await new Promise<IncomingHttpHeaders>((resolve, reject) => {
    const clientRequest = request(
      {
        host,
        port,
        path,
        headers: {
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      response => {
        const output =
          response.headers['content-encoding'] === 'gzip'
            ? response.pipe(createGunzip())
            : response;

        response.on('data', chunk => {
          rawChunks.push({
            dt: Math.round(performance.now() - startedAt),
            length: chunk.length,
          });
        });

        output.on('data', chunk => {
          decodedChunks.push({
            dt: Math.round(performance.now() - startedAt),
            length: chunk.length,
            text: chunk.toString(),
          });
        });

        output.on('end', () => resolve(response.headers));
        output.on('error', reject);
      },
    );

    clientRequest.on('error', reject);
    clientRequest.end();
  });

  const eventTimes = decodedChunks.flatMap(chunk =>
    chunk.text
      .split('\n\n')
      .filter(event => event.startsWith('data: '))
      .map(() => chunk.dt),
  );

  return {
    headers,
    decodedChunks,
    rawChunks,
    eventTimes,
    spanMs:
      eventTimes.length === 0
        ? 0
        : Math.max(...eventTimes) - Math.min(...eventTimes),
  };
}

function printProbeSummary({
  sdk,
  workaround,
  port,
}: {
  sdk: ProbeResult;
  workaround: ProbeResult;
  port: number;
}) {
  console.log(
    JSON.stringify(
      {
        nextVersion: '13.0.5',
        requestHeaders: { 'Accept-Encoding': 'gzip, deflate, br' },
        port,
        sdk: summarizeProbe(sdk),
        workaround: summarizeProbe(workaround),
      },
      null,
      2,
    ),
  );
}

function summarizeProbe(result: ProbeResult) {
  return {
    responseHeaders: {
      'content-encoding': result.headers['content-encoding'] ?? null,
      'content-type': result.headers['content-type'] ?? null,
      'cache-control': result.headers['cache-control'] ?? null,
    },
    rawChunks: result.rawChunks,
    decodedChunks: result.decodedChunks.map(chunk => ({
      dt: chunk.dt,
      length: chunk.length,
      text: chunk.text.replaceAll('\n', '\\n').slice(0, 120),
    })),
    eventTimes: result.eventTimes,
    eventSpanMs: result.spanMs,
  };
}

function isIncremental(result: ProbeResult) {
  return result.eventTimes.length >= eventCount && result.spanMs >= 400;
}

async function requestPath({ port, path }: { port: number; path: string }) {
  await new Promise<void>((resolvePromise, reject) => {
    const clientRequest = request({ host, port, path }, response => {
      response.resume();
      response.on('end', resolvePromise);
    });

    clientRequest.on('error', reject);
    clientRequest.end();
  });
}

async function getFreePort() {
  const server = createServer();
  await new Promise<void>(resolvePromise => {
    server.listen(0, host, resolvePromise);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Unable to allocate a TCP port for the reproduction.');
  }

  const port = address.port;
  await closeServer(server);
  return port;
}

async function closeServer(server: Server) {
  await new Promise<void>((resolvePromise, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

async function runCommand({
  command,
  args,
  cwd,
}: {
  command: string;
  args: string[];
  cwd: string;
}) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolvePromise();
      else
        reject(new Error(`${command} ${args.join(' ')} failed with ${code}`));
    });
  });
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.pid === undefined) return;

  if (process.platform === 'win32') {
    child.kill('SIGTERM');
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }

  await Promise.race([
    new Promise<void>(resolvePromise => {
      child.once('exit', () => resolvePromise());
    }),
    delay(5_000),
  ]);

  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

function delay(ms: number) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
