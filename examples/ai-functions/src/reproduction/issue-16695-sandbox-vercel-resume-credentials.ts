import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';

async function main() {
  const sandbox = createVercelSandbox({
    token: process.env.VERCEL_TOKEN ?? 'issue-16695-repro-token',
    teamId: process.env.VERCEL_TEAM_ID ?? 'team_issue_16695',
    projectId: process.env.VERCEL_PROJECT_ID ?? 'prj_issue_16695',
  });

  try {
    await sandbox.resumeSession!({
      sessionId: 'issue-16695',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('Could not get credentials from OIDC context')) {
      console.error(
        [
          'Reproduced issue #16695.',
          'resumeSession was configured with token/teamId/projectId, but @vercel/sandbox still attempted OIDC credential lookup.',
          '',
          message,
        ].join('\n'),
      );
      process.exitCode = 1;
      return;
    }

    throw error;
  }

  throw new Error(
    'Expected resumeSession to fail by attempting OIDC credential lookup, but it completed successfully.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
