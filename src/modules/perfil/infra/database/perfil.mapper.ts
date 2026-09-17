import type {
  Moradia as MoradiaDb,
  Profile as ProfileRow,
  TipoRenda as TipoRendaDb,
} from '../../../../generated/prisma/client';
import { decimalToNumber, numberToDecimal } from '../../../../shared/infra/database/decimal';
import type { Moradia, TipoRenda } from '../../../../shared/motor/types';
import { Perfil } from '../../domain/perfil';

/*
  Linha do Prisma ⇄ entidade. Enums MAIÚSCULOS no banco (CLT, PAIS) e
  minúsculos no domínio e na API, como o frontend manda; dinheiro
  Decimal(12,2) ⇄ number. A chave do perfil é o próprio subscriber_id.
*/

export function tipoRendaToDomain(tipo: TipoRendaDb): TipoRenda {
  return tipo.toLowerCase() as TipoRenda;
}

export function tipoRendaToDb(tipo: TipoRenda): TipoRendaDb {
  return tipo.toUpperCase() as TipoRendaDb;
}

export function moradiaToDomain(moradia: MoradiaDb): Moradia {
  return moradia.toLowerCase() as Moradia;
}

export function moradiaToDb(moradia: Moradia): MoradiaDb {
  return moradia.toUpperCase() as MoradiaDb;
}

export function toDomain(row: ProfileRow): Perfil {
  return Perfil.restaurar({
    subscriberId: row.subscriberId,
    rendaMensal: decimalToNumber(row.rendaMensal),
    tipoRenda: tipoRendaToDomain(row.tipoRenda),
    idade: row.idade,
    moradia: moradiaToDomain(row.moradia),
    custoMoradia: decimalToNumber(row.custoMoradia),
    guardado: decimalToNumber(row.guardado),
    atualizadoEm: row.atualizadoEm,
  });
}

export function toPersistence(perfil: Perfil) {
  const p = perfil.toSnapshot();
  return {
    subscriberId: p.subscriberId,
    rendaMensal: numberToDecimal(p.rendaMensal),
    tipoRenda: tipoRendaToDb(p.tipoRenda),
    idade: p.idade,
    moradia: moradiaToDb(p.moradia),
    custoMoradia: numberToDecimal(p.custoMoradia),
    guardado: numberToDecimal(p.guardado),
    // explícito: sem ele o @updatedAt do Prisma gravaria a hora do servidor, e a memória a do Clock
    atualizadoEm: p.atualizadoEm,
  };
}
