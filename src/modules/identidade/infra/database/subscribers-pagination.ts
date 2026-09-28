import { decodeCursor, MAX_PAGE_LIMIT } from '../../../../shared/application/pagination';

/*
  Regras de página compartilhadas pelas duas implementações de listEmailable —
  escritas uma vez só, senão memória e Prisma divergem no primeiro ajuste.
*/

/** O cursor é o id do último item entregue. Mesmo teto do id na entrada HTTP. */
export function decodeSubscriberCursor(cursor: string | null | undefined): string | undefined {
  return decodeCursor(cursor, (id) => id.length <= 64);
}

/**
 * Quem chama é o job, não o cliente HTTP (que já passa pelo schema). Um limite
 * fora da faixa (0, NaN, 10 mil) vira página vazia com cursor quebrado ou
 * consulta gigante; aqui ele cai dentro de 1..MAX_PAGE_LIMIT.
 */
export function clampPageLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_PAGE_LIMIT);
}
