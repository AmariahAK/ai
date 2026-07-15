import { describe, expectTypeOf, it } from 'vitest';
import type { JSONValue } from './json-value';

describe('JSONValue', () => {
  it('should accept readonly arrays and objects containing them', () => {
    const readonlyArray = [
      'value',
      {
        nested: [1, true, null] as const,
      },
    ] as const;
    const readonlyObject = {
      nested: readonlyArray,
    } as const;

    expectTypeOf(readonlyArray).toMatchTypeOf<JSONValue>();
    expectTypeOf(readonlyObject).toMatchTypeOf<JSONValue>();
  });
});
