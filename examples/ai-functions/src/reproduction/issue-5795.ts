import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const port = 35795;
const baseUrl = `http://127.0.0.1:${port}`;
const reproductionPath = '/reproduction/issue-5795';
const attemptsPerScenario = 25;

async function waitForServer(process: ChildProcess) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (process.exitCode != null) {
      throw new Error(`Next.js exited early with code ${process.exitCode}.`);
    }

    try {
      const response = await fetch(`${baseUrl}${reproductionPath}`);
      if (response.ok) {
        return;
      }
    } catch {
      // The development server is still starting.
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error('Timed out waiting for the Next.js reproduction server.');
}

async function stopServer(process: ChildProcess) {
  if (process.exitCode != null) {
    return;
  }

  process.kill('SIGTERM');

  await Promise.race([
    new Promise<void>(resolve => process.once('exit', () => resolve())),
    new Promise<void>(resolve =>
      setTimeout(() => {
        process.kill('SIGKILL');
        resolve();
      }, 5_000),
    ),
  ]);
}

async function main() {
  const server = spawn(
    'pnpm',
    [
      '-C',
      'examples/next-openai-pages',
      'exec',
      'next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let serverOutput = '';
  server.stdout.on('data', chunk => {
    serverOutput += String(chunk);
  });
  server.stderr.on('data', chunk => {
    serverOutput += String(chunk);
  });

  try {
    await waitForServer(server);

    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      let documentRequests = 0;

      page.on('request', request => {
        if (request.resourceType() === 'document') {
          documentRequests += 1;
        }
      });

      await page.goto(`${baseUrl}${reproductionPath}`, {
        waitUntil: 'networkidle',
      });
      await page.getByTestId('page-load-count').waitFor();

      for (let index = 1; index <= attemptsPerScenario; index++) {
        await page.getByTestId('direct-submit').click();
        await page
          .getByTestId('completed-count')
          .getByText(String(index), { exact: true })
          .waitFor();
      }

      for (let index = 1; index <= attemptsPerScenario; index++) {
        const expectedCount = attemptsPerScenario + index;
        await page.getByTestId('form-submit').click();
        await page
          .getByTestId('completed-count')
          .getByText(String(expectedCount), { exact: true })
          .waitFor();
      }

      const result = {
        directSubmitAttempts: attemptsPerScenario,
        preventedFormSubmitAttempts: attemptsPerScenario,
        completedRequests: Number(
          await page.getByTestId('completed-count').textContent(),
        ),
        pageLoadCount: Number(
          await page.getByTestId('page-load-count').textContent(),
        ),
        documentRequests,
        finalObject: await page.getByTestId('object').textContent(),
        error: await page.getByTestId('error').textContent(),
      };

      console.log(JSON.stringify(result, null, 2));

      if (result.pageLoadCount !== 1 || documentRequests !== 1) {
        throw new Error(
          `Reproduced issue #5795: useObject().submit() reloaded the page (pageLoadCount=${result.pageLoadCount}, documentRequests=${documentRequests}).`,
        );
      }

      if (result.completedRequests !== attemptsPerScenario * 2) {
        throw new Error(
          `Expected ${attemptsPerScenario * 2} completed requests, received ${result.completedRequests}.`,
        );
      }

      if (result.error !== '') {
        throw new Error(`useObject reported an error: ${result.error}`);
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error(serverOutput);
    throw error;
  } finally {
    await stopServer(server);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
