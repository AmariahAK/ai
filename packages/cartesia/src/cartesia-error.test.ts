import { safeParseJSON } from '@ai-sdk/provider-utils';
import { cartesiaErrorDataSchema } from './cartesia-error';
import { describe, expect, it } from 'vitest';

describe('cartesiaErrorDataSchema', () => {
  it('should parse a Cartesia error', async () => {
    const error = `{"error":"Invalid API key."}`;

    const result = await safeParseJSON({
      text: error,
      schema: cartesiaErrorDataSchema,
    });

    expect(result).toStrictEqual({
      success: true,
      value: {
        error: 'Invalid API key.',
      },
      rawValue: {
        error: 'Invalid API key.',
      },
    });
  });
});
