import {
  auth,
  type OAuthClientInformation,
  type OAuthClientProvider,
  type OAuthTokens,
} from '@ai-sdk/mcp';
import fs from 'node:fs';
import { ZodError } from 'zod/v4';

const serverUrl = new URL('https://aws-mcp.us-east-1.api.aws/mcp');
const resourceMetadataUrl = new URL(
  'https://aws-mcp.us-east-1.api.aws/.well-known/oauth-protected-resource',
);
const authorizationServerUrl = new URL('https://us-east-1.oauth.signin.aws');
const registrationEndpoint = new URL('/v1/register', authorizationServerUrl)
  .href;
const dcrReached = new Error('DCR_REACHED');

const awsSignInMetadata = JSON.parse(
  fs.readFileSync(
    new URL(
      '../../../../packages/mcp/src/tool/__fixtures__/aws-signin-oauth-metadata.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

const provider: OAuthClientProvider = {
  redirectUrl: 'http://localhost:8090/oauth/callback',
  clientMetadata: {
    redirect_uris: ['http://localhost:8090/oauth/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: 'issue-17334-reproduction',
  },
  tokens(): OAuthTokens | undefined {
    return undefined;
  },
  saveTokens() {},
  clientInformation(): OAuthClientInformation | undefined {
    return undefined;
  },
  saveClientInformation() {},
  saveCodeVerifier() {},
  codeVerifier() {
    return '';
  },
  redirectToAuthorization() {},
};

function createFixtureFetch(): typeof fetch {
  return async input => {
    const url = new URL(String(input));

    if (url.href === resourceMetadataUrl.href) {
      return Response.json({
        resource: serverUrl.href,
        authorization_servers: [`${authorizationServerUrl.href}/`],
      });
    }

    if (
      url.href ===
      new URL('/.well-known/oauth-authorization-server', authorizationServerUrl)
        .href
    ) {
      return Response.json(awsSignInMetadata);
    }

    if (url.href === registrationEndpoint) {
      throw dcrReached;
    }

    return new Response(null, { status: 404 });
  };
}

function createLiveFetch(): typeof fetch {
  return async (input, init) => {
    if (new URL(String(input)).href === registrationEndpoint) {
      throw dcrReached;
    }

    return fetch(input, init);
  };
}

async function main() {
  const fetchFn =
    process.env.ISSUE_17334_LIVE === '1'
      ? createLiveFetch()
      : createFixtureFetch();

  try {
    await auth(provider, {
      serverUrl,
      resourceMetadataUrl,
      fetchFn,
    });
  } catch (error) {
    if (error === dcrReached) {
      console.log(
        'OAuth metadata was accepted and Dynamic Client Registration was reached.',
      );
      return;
    }

    if (
      error instanceof ZodError &&
      error.issues.some(issue =>
        issue.path.includes('code_challenge_methods_supported'),
      )
    ) {
      console.error(
        'ISSUE_17334_REPRODUCED: OAuth metadata without code_challenge_methods_supported was rejected before Dynamic Client Registration',
      );
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

main();
