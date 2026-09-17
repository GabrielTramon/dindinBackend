import { Prisma } from '../../../generated/prisma/client';

/*
  Tradução dos erros conhecidos do Prisma. Repositórios usam estas funções pra
  converter violação de constraint em erro de aplicação — o caso de uso nunca
  vê um código "P2002".
*/

function knownCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

/** Violação de @unique / @@unique. */
export function isUniqueViolation(error: unknown): boolean {
  return knownCode(error) === 'P2002';
}

/** Chave estrangeira: referência inexistente, ou exclusão bloqueada por onDelete: Restrict. */
export function isForeignKeyViolation(error: unknown): boolean {
  const code = knownCode(error);
  return code === 'P2003' || code === 'P2014';
}

/** update/delete de registro que não existe. */
export function isRecordNotFound(error: unknown): boolean {
  return knownCode(error) === 'P2025';
}
