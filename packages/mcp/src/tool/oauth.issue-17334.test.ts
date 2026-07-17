import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { discoverAuthorizationServerMetadata } from './oauth';

const awsSignInMetadata = JSON.parse(
  fs.readFileSync(
    'src/tool/__fixtures__/aws-signin-oauth-metadata.json',
    'utf8',
  ),
);

describe('issue #17334', () => {
  it('accepts AWS Sign-In OAuth metadata without the optional PKCE metadata field', async () => {
    await expect(
      discoverAuthorizationServerMetadata(
        'https://us-east-1.oauth.signin.aws',
        {
          fetchFn: async () => Response.json(awsSignInMetadata),
        },
      ),
    ).resolves.toEqual(awsSignInMetadata);
  });
});
