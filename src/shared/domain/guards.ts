import type { z } from 'zod';
import { ValidationError } from './errors';

/*
  Guardas usadas pelas entidades pra proteger invariantes.

  Sempre que existe regra equivalente no motor (src/shared/motor/schema.ts),
  a entidade valida COM o schema do motor — mesmos limites e mesmas mensagens
  do frontend. Duas regras parecidas escritas à mão divergem na primeira
  mudança.
*/

export function invalid(field: string, message: string): never {
  throw new ValidationError(message, { [field]: message });
}

export function ensure(condition: boolean, field: string, message: string): asserts condition {
  if (!condition) invalid(field, message);
}

/** Valida um campo com um schema zod e devolve o valor já normalizado. */
export function validateField<S extends z.ZodType>(schema: S, value: unknown, field: string): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.length ? `${field}.${issue.path.map(String).join('.')}` : field;
  const message = issue?.message ?? 'Valor inválido';
  throw new ValidationError(message, { [path]: message });
}

/** Tira espaço das pontas e junta espaços repetidos: "  Clube   do  bairro " → "Clube do bairro". */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Teto do Decimal(12,2) do banco. */
export const MAX_MONEY = 9_999_999_999.99;

/**
 * No máximo `casas` casas decimais.
 *
 * Não multiplica: 19.99 * 100 = 1998.9999999999998 em ponto flutuante, e a
 * comparação com Math.round recusava ~13% dos valores válidos (R$ 19,99,
 * R$ 1,10, R$ 0,07). toFixed arredonda pro decimal mais próximo e só volta
 * igual quando o número já tinha no máximo essas casas. Valores até o teto
 * nunca caem em notação exponencial no toFixed.
 */
export function hasAtMostDecimals(value: number, casas: number): boolean {
  return Number.isFinite(value) && Number(value.toFixed(casas)) === value;
}

export function hasAtMostTwoDecimals(value: number): boolean {
  return hasAtMostDecimals(value, 2);
}

export function isValidMoney(value: number, { allowZero = false } = {}): boolean {
  return (
    Number.isFinite(value) &&
    (allowZero ? value >= 0 : value > 0) &&
    value <= MAX_MONEY &&
    hasAtMostTwoDecimals(value)
  );
}

/**
 * Garante 2 casas num valor que já passou pela validação do motor. O Postgres
 * arredondaria 10.005 pra 10.01 em silêncio; a memória guardaria 10.005 — os
 * dois modos divergiriam.
 */
export function ensureMoneyPrecision(value: number, field: string): void {
  ensure(hasAtMostTwoDecimals(value), field, 'No máximo 2 casas decimais');
}
