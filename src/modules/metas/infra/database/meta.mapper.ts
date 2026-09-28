import type { Goal as MetaRow } from '../../../../generated/prisma/client';
import { decimalToNumber, numberToDecimal } from '../../../../shared/infra/database/decimal';
import { Meta } from '../../domain/meta';

/*
  Linha do Prisma (model Goal, tabela goals) ⇄ entidade. Dinheiro é Decimal(12,2)
  no banco e number no domínio; a entidade já garante no máximo 2 casas, então
  o Decimal nunca arredonda nada na gravação.
*/

export function toDomain(row: MetaRow): Meta {
  return Meta.restaurar({
    id: row.id,
    subscriberId: row.subscriberId,
    nome: row.nome,
    valorAlvo: decimalToNumber(row.valorAlvo),
    aporteMensal: decimalToNumber(row.aporteMensal),
    prazoMeses: row.prazoMeses,
    acumulado: decimalToNumber(row.acumulado),
    publicSlug: row.publicSlug,
    criadoEm: row.criadoEm,
    atualizadoEm: row.atualizadoEm,
  });
}

export function toPersistence(meta: Meta) {
  const m = meta.toSnapshot();
  return {
    id: m.id,
    subscriberId: m.subscriberId,
    nome: m.nome,
    valorAlvo: numberToDecimal(m.valorAlvo),
    aporteMensal: numberToDecimal(m.aporteMensal),
    prazoMeses: m.prazoMeses,
    acumulado: numberToDecimal(m.acumulado),
    publicSlug: m.publicSlug,
    criadoEm: m.criadoEm,
    // passado explicitamente: com valor informado o @updatedAt do Prisma não troca pelo relógio do banco
    atualizadoEm: m.atualizadoEm,
  };
}
