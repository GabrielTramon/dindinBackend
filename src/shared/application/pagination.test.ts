import { describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import { decodeCursor, decodeIntCursor, encodeCursor } from './pagination';

describe('cursores', () => {
  it('ida e volta', () => {
    expect(decodeIntCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(encodeCursor('2026-09'), (v) => /^\d{4}-\d{2}$/.test(v))).toBe('2026-09');
  });

  it.each([undefined, null, ''])('ausente (%j) = do começo', (c) => {
    expect(decodeIntCursor(c)).toBeUndefined();
  });

  it.each(['lixo!!', encodeCursor('abc'), encodeCursor('0'), encodeCursor('-3'), encodeCursor('1.5'), '%%%'])(
    'corrompido %j → ValidationError, nunca NaN',
    (c) => {
      expect(() => decodeIntCursor(c)).toThrow(ValidationError);
    },
  );
});
