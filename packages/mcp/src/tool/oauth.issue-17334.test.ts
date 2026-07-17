import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { discoverAuthorizationServerMetadata } from './oauth';

const awsSignInMetadata = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/aws-signin-oauth-metadata.json', import.meta.url),
    'utf8',
  ),
);

describe('issue #17334', () => {
  it('accepts RFC 8414 metadata that omits code challenge methods', async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify(awsSignInMetadata), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      discoverAuthorizationServerMetadata(
        'https://us-east-1.oauth.signin.aws',
        { fetchFn },
      ),
    ).resolves.toEqual(awsSignInMetadata);
  });
});
