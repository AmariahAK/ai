import { readFileSync } from 'node:fs';
import {
  auth,
  type OAuthClientProvider,
} from '../../../../packages/mcp/src/tool/oauth';

const awsSignInMetadata = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/mcp/src/tool/__fixtures__/aws-signin-oauth-metadata.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

async function main() {
  let dynamicClientRegistrationReached = false;
  const metadata =
    process.env.INJECT_PKCE === '1'
      ? {
          ...awsSignInMetadata,
          code_challenge_methods_supported: ['S256'],
        }
      : awsSignInMetadata;

  const provider: OAuthClientProvider = {
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

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);

    if (url.includes('/.well-known/oauth-protected-resource')) {
      return Response.json({
        resource: 'https://aws-mcp.us-east-1.api.aws',
        authorization_servers: [awsSignInMetadata.issuer],
      });
    }

    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return Response.json(metadata);
    }

    if (
      url === awsSignInMetadata.registration_endpoint &&
      init?.method === 'POST'
    ) {
      dynamicClientRegistrationReached = true;
      return Response.json({
        client_id: 'reproduction-client',
      });
    }

    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  };

  try {
    await auth(provider, {
      serverUrl: 'https://aws-mcp.us-east-1.api.aws/mcp',
      fetchFn,
    });
  } catch (error) {
    if (!dynamicClientRegistrationReached) {
      const issues =
        typeof error === 'object' && error !== null && 'issues' in error
          ? (error as { issues?: Array<{ path?: PropertyKey[] }> }).issues
          : undefined;
      const rejectedOptionalField = issues?.some(
        issue => issue.path?.[0] === 'code_challenge_methods_supported',
      );

      if (rejectedOptionalField) {
        throw new Error(
          'Issue #17334 reproduced: OAuth metadata without code_challenge_methods_supported was rejected before Dynamic Client Registration',
          { cause: error },
        );
      }
    }

    if (dynamicClientRegistrationReached) {
      console.log(
        'Metadata discovery accepted the document and reached Dynamic Client Registration.',
      );
      return;
    }

    throw error;
  }

  if (!dynamicClientRegistrationReached) {
    throw new Error('Dynamic Client Registration was not reached');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
