import { readFile } from 'node:fs/promises';
import {
  auth,
  type OAuthClientProvider,
} from '../../../../packages/mcp/src/tool/oauth';

type FetchFunction = typeof globalThis.fetch;

const fixtureUrl = new URL(
  '../../../../packages/mcp/src/tool/__fixtures__/aws-signin-oauth-metadata.json',
  import.meta.url,
);

const expectedSchemaMessage =
  'Invalid input: expected array, received undefined';
const reproductionSignal =
  'Issue 17334 reproduced: valid OAuth metadata without code_challenge_methods_supported was rejected before DCR';

function createProvider(): OAuthClientProvider {
  return {
    get redirectUrl() {
      return 'http://localhost:8090/oauth/callback';
    },
    get clientMetadata() {
      return {
        redirect_uris: ['http://localhost:8090/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_name: 'issue-17334-reproduction',
      };
    },
    tokens() {
      return undefined;
    },
    saveTokens() {},
    clientInformation() {
      return undefined;
    },
    saveClientInformation() {},
    saveCodeVerifier() {},
    codeVerifier() {
      return '';
    },
    redirectToAuthorization() {},
  };
}

function createFetch({
  metadata,
  onRegistration,
}: {
  metadata: Record<string, unknown>;
  onRegistration: () => void;
}): FetchFunction {
  return async input => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );

    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return new Response(null, { status: 404 });
    }

    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return Response.json(metadata);
    }

    if (url.pathname === '/v1/register') {
      onRegistration();
      return Response.json({
        client_id: 'recorded-fixture-client',
        redirect_uris: ['http://localhost:8090/oauth/callback'],
      });
    }

    throw new Error(`Unexpected reproduction request: ${url}`);
  };
}

async function reachesDynamicClientRegistration(
  metadata: Record<string, unknown>,
): Promise<{ reached: boolean; error?: unknown }> {
  let reached = false;

  try {
    await auth(createProvider(), {
      serverUrl: String(metadata.issuer),
      fetchFn: createFetch({
        metadata,
        onRegistration: () => {
          reached = true;
        },
      }),
    });
    return { reached };
  } catch (error) {
    return { reached, error };
  }
}

async function main() {
  const metadata = JSON.parse(await readFile(fixtureUrl, 'utf8')) as Record<
    string,
    unknown
  >;

  const reportedResult = await reachesDynamicClientRegistration(metadata);
  const comparisonResult = await reachesDynamicClientRegistration({
    ...metadata,
    code_challenge_methods_supported: ['S256'],
  });

  const rejectedMissingField =
    !reportedResult.reached &&
    reportedResult.error instanceof Error &&
    reportedResult.error.message.includes(expectedSchemaMessage) &&
    reportedResult.error.message.includes('code_challenge_methods_supported');

  if (rejectedMissingField && comparisonResult.reached) {
    console.error(reproductionSignal);
    process.exitCode = 1;
    return;
  }

  if (reportedResult.error && !reportedResult.reached) {
    throw reportedResult.error;
  }

  console.log(
    'Issue 17334 not reproduced: metadata discovery reached Dynamic Client Registration',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
