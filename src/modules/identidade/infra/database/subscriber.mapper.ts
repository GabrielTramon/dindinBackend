import type { Subscriber as SubscriberRow } from '../../../../generated/prisma/client';
import { Subscriber } from '../../domain/subscriber';

/*
  Linha do Prisma ⇄ entidade. A única diferença de nome é documentada no
  CLAUDE.md: a coluna `token` guarda o hash, e o domínio chama de `tokenHash`
  pra ninguém confundir com o token que vai no e-mail.
*/

export function toDomain(row: SubscriberRow): Subscriber {
  return Subscriber.restaurar({
    id: row.id,
    email: row.email,
    tokenHash: row.token,
    tokenExpiraEm: row.tokenExpiraEm,
    emailVerificadoEm: row.emailVerificadoEm,
    ativo: row.ativo,
    criadoEm: row.criadoEm,
    atualizadoEm: row.atualizadoEm,
  });
}

export function toPersistence(subscriber: Subscriber) {
  const s = subscriber.toSnapshot();
  return {
    id: s.id,
    email: s.email,
    token: s.tokenHash,
    tokenExpiraEm: s.tokenExpiraEm,
    emailVerificadoEm: s.emailVerificadoEm,
    ativo: s.ativo,
    criadoEm: s.criadoEm,
    // explícito: sem isso o @updatedAt do Prisma usaria o relógio do servidor, e a memória, o Clock
    atualizadoEm: s.atualizadoEm,
  };
}
