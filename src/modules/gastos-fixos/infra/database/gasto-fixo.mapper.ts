import type { GastoFixo as GastoFixoRow } from '../../../../generated/prisma/client';
import { decimalToNumber, numberToDecimal } from '../../../../shared/infra/database/decimal';
import { GastoFixo } from '../../domain/gasto-fixo';

/*
  Linha do Prisma ⇄ entidade. O dono se chama subscriberId no domínio (como em
  todo módulo) e profile_id no banco, porque a FK aponta pro perfil — cuja
  chave é o próprio subscriber_id. Valor: Decimal(12,2) ⇄ number.
*/

export function toDomain(row: GastoFixoRow): GastoFixo {
  return GastoFixo.restaurar({
    id: row.id,
    subscriberId: row.profileId,
    categoriaId: row.categoriaId,
    valor: decimalToNumber(row.valor),
    criadoEm: row.criadoEm,
  });
}

export function toPersistence(gasto: GastoFixo) {
  const g = gasto.toSnapshot();
  return {
    id: g.id,
    profileId: g.subscriberId,
    categoriaId: g.categoriaId,
    valor: numberToDecimal(g.valor),
    criadoEm: g.criadoEm,
  };
}
