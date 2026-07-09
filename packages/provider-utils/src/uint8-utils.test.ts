import { describe, expect, it } from 'vitest';

import { toArrayBufferBackedUint8Array } from './uint8-utils';

describe('toArrayBufferBackedUint8Array', () => {
  it('creates a view over an existing ArrayBuffer without copying', () => {
    const buffer = new ArrayBuffer(4);
    const input = new Uint8Array(buffer, 1, 2);
    input.set([1, 2]);

    const result = toArrayBufferBackedUint8Array(input);

    expect(result.buffer).toBe(buffer);
    expect(result.byteOffset).toBe(1);
    expect(result).toEqual(new Uint8Array([1, 2]));

    input[0] = 3;
    expect(result[0]).toBe(3);
  });

  it('copies a SharedArrayBuffer-backed view into an ArrayBuffer', () => {
    const buffer = new SharedArrayBuffer(4);
    const input = new Uint8Array(buffer, 1, 2);
    input.set([1, 2]);

    const result = toArrayBufferBackedUint8Array(input);

    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result).toEqual(new Uint8Array([1, 2]));

    input[0] = 3;
    expect(result[0]).toBe(1);
  });
});
