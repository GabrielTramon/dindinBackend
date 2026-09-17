import type { CheckIn as CheckInRow } from '../../../../generated/prisma/client';
import { decimalToNumber, numberToDecimal } from '../../../../shared/infra/database/decimal';
import { CheckIn } from '../../domain/check-in';

/*
  Linha do Prisma ⇄ entidade. Os três valores da resposta são Decimal(12,2)
  nulos até a pessoa responder; a entidade já garante no máximo 2 casas, então
  o Decimal nunca arredonda nada na gravação.
*/

export function toDomain(row: CheckInRow): CheckIn {
  return CheckIn.restaurar({
    id: row.id,
    subscriberId: row.subscriberId,
    competencia: row.competencia,
    rendaReal: decimalToNumber(row.rendaReal),
    gastoReal: decimalToNumber(row.gastoReal),
    guardadoReal: decimalToNumber(row.guardadoReal),
    enviadoEm: row.enviadoEm,
    respondidoEm: row.respondidoEm,
    criadoEm: row.criadoEm,
  });
}

export function toPersistence(checkIn: CheckIn) {
  const c = checkIn.toSnapshot();
  return {
    id: c.id,
    subscriberId: c.subscriberId,
    competencia: c.competencia,
    rendaReal: numberToDecimal(c.rendaReal),
    gastoReal: numberToDecimal(c.gastoReal),
    guardadoReal: numberToDecimal(c.guardadoReal),
    enviadoEm: c.enviadoEm,
    respondidoEm: c.respondidoEm,
    criadoEm: c.criadoEm,
  };
}
