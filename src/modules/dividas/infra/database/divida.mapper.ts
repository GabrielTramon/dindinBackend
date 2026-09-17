import type { Divida as DividaRow, TipoDivida as TipoDividaDb } from '../../../../generated/prisma/client';
import { decimalToNumber, numberToDecimal } from '../../../../shared/infra/database/decimal';
import { Divida, type TipoDivida } from '../../domain/divida';

/*
  Linha do Prisma ⇄ entidade. Três traduções:
  - enum do banco MAIÚSCULO (CHEQUE_ESPECIAL) ⇄ minúsculo no domínio e na API (cheque_especial);
  - coluna profile_id ⇄ subscriberId (o perfil usa o id do subscriber como chave);
  - Decimal ⇄ number: saldo e parcela Decimal(12,2), taxaAnual Decimal(8,4).
*/

export function tipoToDomain(tipo: TipoDividaDb): TipoDivida {
  return tipo.toLowerCase() as TipoDivida;
}

export function tipoToDb(tipo: TipoDivida): TipoDividaDb {
  return tipo.toUpperCase() as TipoDividaDb;
}

export function toDomain(row: DividaRow): Divida {
  return Divida.restaurar({
    id: row.id,
    subscriberId: row.profileId,
    tipo: tipoToDomain(row.tipo),
    saldo: decimalToNumber(row.saldo),
    parcela: decimalToNumber(row.parcela),
    taxaAnual: decimalToNumber(row.taxaAnual),
    criadoEm: row.criadoEm,
  });
}

export function toPersistence(divida: Divida) {
  const d = divida.toSnapshot();
  return {
    id: d.id,
    profileId: d.subscriberId,
    tipo: tipoToDb(d.tipo),
    saldo: numberToDecimal(d.saldo),
    parcela: numberToDecimal(d.parcela),
    taxaAnual: numberToDecimal(d.taxaAnual),
    criadoEm: d.criadoEm,
  };
}
