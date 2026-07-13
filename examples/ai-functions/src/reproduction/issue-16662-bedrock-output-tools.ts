import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import {
  generateText,
  NoObjectGeneratedError,
  Output,
  stepCountIs,
  tool,
} from 'ai';
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const modelId = 'us.anthropic.claude-opus-4-8';
const region = 'us-east-1';
const batchRuns = Number.parseInt(process.env.BATCH_RUNS ?? '12', 10);
const fixturePath = fileURLToPath(
  new URL(
    '../../../../packages/amazon-bedrock/src/__fixtures__/issue-16662-live.json',
    import.meta.url,
  ),
);

type RecordedCall = {
  requestBody: string | null;
  responseBody: string;
  status: number;
};

async function main() {
  if (!Number.isInteger(batchRuns) || batchRuns < 1) {
    throw new Error(`BATCH_RUNS must be a positive integer, got ${batchRuns}.`);
  }

  const callsByRun: RecordedCall[][] = Array.from(
    { length: batchRuns },
    () => [],
  );
  let activeRun = 0;

  const bedrock = createAmazonBedrock({
    region,
    fetch: async (input, init) => {
      const response = await globalThis.fetch(input, init);
      callsByRun[activeRun].push({
        requestBody:
          typeof init?.body === 'string'
            ? init.body
            : input instanceof Request
              ? await input.clone().text()
              : null,
        responseBody: await response.clone().text(),
        status: response.status,
      });
      return response;
    },
  });

  const failures: Array<{
    run: number;
    message: string;
    text: string | undefined;
  }> = [];
  const summaries: Array<{
    run: number;
    output: unknown;
    steps: number;
    toolNames: string[];
  }> = [];

  for (let run = 0; run < batchRuns; run++) {
    activeRun = run;

    try {
      const result = await generateText({
        model: bedrock(modelId),
        maxOutputTokens: 400,
        stopWhen: stepCountIs(15),
        output: Output.object({
          schema: z.object({
            decision: z.enum(['approve', 'deny']),
            accountTier: z.string(),
            policyLimit: z.number(),
          }),
        }),
        tools: {
          lookupAccount: tool({
            description: 'Look up the account tier for an account ID.',
            inputSchema: z.object({ accountId: z.string() }),
            execute: async () => ({ accountTier: 'gold' }),
          }),
          lookupPolicy: tool({
            description: 'Look up the numeric limit for a policy ID.',
            inputSchema: z.object({ policyId: z.string() }),
            execute: async () => ({ policyLimit: 100 }),
          }),
        },
        prompt:
          'You must call lookupAccount with accountId "acct-16662" and lookupPolicy with policyId "policy-16662" before answering. Approve when the account tier is gold and the policy limit is at least 100. Return the requested structured output.',
      });

      const toolNames = result.steps.flatMap(step =>
        step.toolCalls.map(call => call.toolName),
      );

      if (
        !toolNames.includes('lookupAccount') ||
        !toolNames.includes('lookupPolicy')
      ) {
        throw new Error(
          `Run ${run + 1} did not call both tools: ${toolNames.join(', ')}`,
        );
      }

      summaries.push({
        run: run + 1,
        output: result.output,
        steps: result.steps.length,
        toolNames,
      });
      console.log(
        `run ${run + 1}/${batchRuns}: success (${result.steps.length} steps)`,
      );
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) {
        throw error;
      }

      failures.push({
        run: run + 1,
        message: error.message,
        text: error.text,
      });
      console.error(`run ${run + 1}/${batchRuns}: ${error.message}`);
    }
  }

  if (process.env.RECORD_FIXTURE === '1') {
    await mkdir(
      new URL(
        '../../../../packages/amazon-bedrock/src/__fixtures__/',
        import.meta.url,
      ),
      {
        recursive: true,
      },
    );
    await writeFile(
      fixturePath,
      `${JSON.stringify(
        {
          issue: 16662,
          modelId,
          region,
          capturedRuns:
            failures.length > 0
              ? failures.slice(0, 1).map(failure => callsByRun[failure.run - 1])
              : callsByRun.slice(0, 1),
          failures,
          representativeSummaries: summaries.slice(0, 3),
          batchSummary: {
            batchRuns,
            failures: failures.length,
            successes: summaries.length,
          },
        },
        null,
        2,
      )}\n`,
    );
    console.log(`recorded ${fixturePath}`);
  }

  console.log(
    JSON.stringify(
      {
        batchRuns,
        failures: failures.length,
        successes: summaries.length,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    throw new Error(
      `Reproduced issue #16662 in ${failures.length}/${batchRuns} runs.`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
