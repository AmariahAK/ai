import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { discoverAuthorizationServerMetadata } from './oauth';

const awsSignInMetadata = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/aws-signin-oauth-metadata.json', import.meta.url),
    'utf8',
  ),
);

it('accepts RFC 8414 metadata that omits code challenge methods', async () => {
  const fetchFn = vi.fn(async () =>
    Response.json(awsSignInMetadata, { status: 200 }),
  );

  await expect(
    discoverAuthorizationServerMetadata(awsSignInMetadata.issuer, { fetchFn }),
  ).resolves.toEqual(awsSignInMetadata);
});
