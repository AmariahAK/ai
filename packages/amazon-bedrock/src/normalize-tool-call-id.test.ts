import { describe, it, expect } from 'vitest';
import { isMistralModel, normalizeToolCallId } from './normalize-tool-call-id';

describe('isMistralModel', () => {
  it('should return true for mistral models', () => {
    expect(isMistralModel('mistral.mistral-7b-instruct-v0:2')).toBe(true);
    expect(isMistralModel('mistral.mixtral-8x7b-instruct-v0:1')).toBe(true);
    expect(isMistralModel('mistral.mistral-large-2402-v1:0')).toBe(true);
    expect(isMistralModel('mistral.mistral-small-2402-v1:0')).toBe(true);
    expect(isMistralModel('mistral.mistral-large-2407-v1:0')).toBe(true);
    expect(isMistralModel('mistral.ministral-3-14b-instruct')).toBe(true);
    expect(isMistralModel('mistral.ministral-3-8b-instruct')).toBe(true);
  });

  it('should return true for region-prefixed mistral models', () => {
    expect(isMistralModel('us.mistral.pixtral-large-2502-v1:0')).toBe(true);
    expect(isMistralModel('eu.mistral.mistral-large-2407-v1:0')).toBe(true);
  });

  it('should return false for non-mistral models', () => {
    expect(isMistralModel('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe(
      false,
    );
    expect(isMistralModel('amazon.nova-pro-v1:0')).toBe(false);
    expect(isMistralModel('openai.gpt-4o')).toBe(false);
    expect(isMistralModel('meta.llama3-70b-instruct-v1:0')).toBe(false);
  });
});

describe('normalizeToolCallId', () => {
  it('should return the original ID when not a Mistral model', () => {
    const originalId = 'tooluse_bpe71yCfRu2b5i-nKGDr5g';
    expect(normalizeToolCallId(originalId, false)).toBe(originalId);
  });

  it('should hash Bedrock tool call IDs to 9 alphanumeric characters for Mistral models', () => {
    expect(normalizeToolCallId('tooluse_bpe71yCfRu2b5i-nKGDr5g', true)).toMatch(
      /^[a-zA-Z0-9]{9}$/,
    );
  });

  it('should deterministically normalize the same ID', () => {
    const toolCallId = 'tooluse_bpe71yCfRu2b5i-nKGDr5g';

    expect(normalizeToolCallId(toolCallId, true)).toBe(
      normalizeToolCallId(toolCallId, true),
    );
  });

  it('should handle IDs with various special characters', () => {
    expect(normalizeToolCallId('tool-use_123ABC456', true)).toMatch(
      /^[a-zA-Z0-9]{9}$/,
    );
    expect(normalizeToolCallId('___abc123DEF___', true)).toMatch(
      /^[a-zA-Z0-9]{9}$/,
    );
  });

  it('should preserve IDs that are already valid Mistral tool call IDs', () => {
    expect(normalizeToolCallId('abcdefghi', true)).toBe('abcdefghi');
    expect(normalizeToolCallId('abc123XYZ', true)).toBe('abc123XYZ');
  });

  it('should handle short IDs', () => {
    expect(normalizeToolCallId('abc', true)).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(normalizeToolCallId('12345', true)).toMatch(/^[a-zA-Z0-9]{9}$/);
  });

  it('should handle IDs with only special characters', () => {
    expect(normalizeToolCallId('___---___', true)).toMatch(/^[a-zA-Z0-9]{9}$/);
  });

  it('should produce valid Mistral tool call IDs (9 alphanumeric chars)', () => {
    const normalizedId = normalizeToolCallId(
      'tooluse_bpe71yCfRu2b5i-nKGDr5g',
      true,
    );
    expect(normalizedId).toMatch(/^[a-zA-Z0-9]{9}$/);
  });

  it('should not collide for distinct Bedrock IDs that share the tooluse prefix and first two suffix chars', () => {
    const a = normalizeToolCallId('tooluse_Ac1Xq9ZklmNoPq', true);
    const b = normalizeToolCallId('tooluse_Ac2Yt7WrstUvWx', true);

    expect(a).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(b).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(a).not.toBe(b);
  });
});
