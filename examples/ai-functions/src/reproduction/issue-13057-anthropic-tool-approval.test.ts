import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runReproduction } from './issue-13057-anthropic-tool-approval.js';

describe('issue 13057 Anthropic tool approval', () => {
  it('executes an approved UI tool and sends an immediate tool_result', async () => {
    const fixtureUrls = [
      new URL(
        '../../../../packages/anthropic/src/__fixtures__/issue-13057-approved-tool.1.chunks.txt',
        import.meta.url,
      ),
      new URL(
        '../../../../packages/anthropic/src/__fixtures__/issue-13057-approved-tool.2.chunks.txt',
        import.meta.url,
      ),
    ];
    const fixtures = await Promise.all(
      fixtureUrls.map(url => readFile(url, 'utf8')),
    );
    let responseIndex = 0;

    const result = await runReproduction({
      providerFetch: async () =>
        new Response(fixtures[responseIndex++], {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        }),
    });

    expect(responseIndex).toBe(2);
    expect(result.executionCount).toBe(1);
    expect(result.capturedErrors).toEqual([]);
    expect(
      result.continuationChunks.some(
        chunk => chunk.type === 'tool-output-available',
      ),
    ).toBe(true);
  });
});
