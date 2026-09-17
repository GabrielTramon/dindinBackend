import { describe, expect, it } from 'vitest';
import { commonSchemas } from '../infra/http/validation';
import { hasAtMostDecimals, hasAtMostTwoDecimals, isValidMoney } from './guards';

describe('hasAtMostTwoDecimals', () => {
  it.each([0, 0.01, 0.07, 0.29, 1.1, 2.3, 4.35, 9.95, 19.99, 150.7, 1234.56, 2500.99, 9_999_999_999.99])(
    'aceita %d',
    (v) => {
      expect(hasAtMostTwoDecimals(v)).toBe(true);
    },
  );

  it.each([19.991, 10.005, 0.004, 0.1 + 0.2, Number.NaN, Number.POSITIVE_INFINITY])('recusa %d', (v) => {
    expect(hasAtMostTwoDecimals(v)).toBe(false);
  });

  it('aceita todos os valores com centavos de R$ 0,00 a R$ 10.000,00 (a regra antiga recusava 131 mil deles)', () => {
    let recusados = 0;
    for (let centavos = 0; centavos <= 1_000_000; centavos++) {
      if (!hasAtMostTwoDecimals(centavos / 100)) recusados++;
    }
    expect(recusados).toBe(0);
  });

  it('taxa com 4 casas', () => {
    expect(hasAtMostDecimals(4.3, 4)).toBe(true);
    expect(hasAtMostDecimals(0.1234, 4)).toBe(true);
    expect(hasAtMostDecimals(0.12345, 4)).toBe(false);
  });
});

describe('isValidMoney', () => {
  it('zero só com allowZero; teto do Decimal(12,2)', () => {
    expect(isValidMoney(0)).toBe(false);
    expect(isValidMoney(0, { allowZero: true })).toBe(true);
    expect(isValidMoney(19.99)).toBe(true);
    expect(isValidMoney(-0.01, { allowZero: true })).toBe(false);
    expect(isValidMoney(10_000_000_000)).toBe(false);
  });
});

describe('commonSchemas.money / moneyOrZero', () => {
  it('aceitam centavos e recusam 3 casas com mensagem', () => {
    expect(commonSchemas.money.safeParse(19.99).success).toBe(true);
    expect(commonSchemas.moneyOrZero.safeParse(1.1).success).toBe(true);
    const r = commonSchemas.money.safeParse(10.005);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('No máximo 2 casas decimais');
  });
});
