import { ValidationError } from '../domain/errors';

/*
  Paginação por cursor. O cursor é opaco pra quem chama: cada repositório
  decide o que codifica nele (uma versão, uma competência, um id). Cursor
  sobrevive a inserções no meio da lista; offset não.

  Cursor ausente = do começo. Cursor presente mas ilegível (corrompido,
  editado à mão, de outra listagem) = ValidationError (400) — nunca NaN
  chegando no banco e virando 500.
*/

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface PageRequest {
  limit: number;
  cursor?: string | null;
}

export interface Page<T> {
  items: T[];
  /** null quando não há mais páginas */
  nextCursor: string | null;
}

export function encodeCursor(value: string | number): string {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function invalidCursor(): never {
  throw new ValidationError('Cursor de paginação inválido. Recomece do início.', { cursor: 'Cursor inválido' });
}

/**
 * Decodifica e valida. undefined quando ausente; ValidationError quando o valor
 * decodificado não passa em `isValid`.
 */
export function decodeCursor(
  cursor: string | null | undefined,
  isValid: (value: string) => boolean,
): string | undefined {
  if (cursor === undefined || cursor === null || cursor === '') return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) invalidCursor();
  const value = Buffer.from(cursor, 'base64url').toString('utf8');
  if (value.length === 0 || !isValid(value)) invalidCursor();
  return value;
}

/** Cursor de inteiro positivo (ex.: versão do plano). */
export function decodeIntCursor(cursor: string | null | undefined): number | undefined {
  const value = decodeCursor(cursor, (v) => /^[1-9]\d{0,15}$/.test(v));
  return value === undefined ? undefined : Number(value);
}
