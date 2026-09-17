import type { Plan as PlanRow, Prisma } from '../../../../generated/prisma/client';
import { VersaoPlano, type PerfilDoMotor, type PlanoDoMotor } from '../../domain/versao-plano';

/*
  Linha do Prisma ⇄ entidade. inputSnap e resultado são JSONB: o Prisma tipa
  como JsonValue genérico, e as conversões abaixo só dizem ao TypeScript o que
  a coluna guarda. O que entra no banco saiu de VersaoPlano.criar (já
  normalizado como JSON); na leitura, como todo restaurar, não se revalida.
*/

export function toDomain(row: PlanRow): VersaoPlano {
  return VersaoPlano.restaurar({
    id: row.id,
    subscriberId: row.subscriberId,
    versao: row.versao,
    inputSnap: row.inputSnap as unknown as PerfilDoMotor,
    resultado: row.resultado as unknown as PlanoDoMotor,
    criadoEm: row.criadoEm,
  });
}

export function toPersistence(versao: VersaoPlano) {
  const v = versao.toSnapshot();
  return {
    id: v.id,
    subscriberId: v.subscriberId,
    versao: v.versao,
    // interface sem assinatura de índice não é atribuível a InputJsonObject, embora seja JSON puro
    inputSnap: v.inputSnap as unknown as Prisma.InputJsonValue,
    resultado: v.resultado as unknown as Prisma.InputJsonValue,
    criadoEm: v.criadoEm,
  };
}
