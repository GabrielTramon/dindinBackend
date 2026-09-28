import type { Grupo as GrupoRow, ItemGrupo as ItemGrupoRow } from '../../../../generated/prisma/client';
import { decimalToNumber, numberToDecimal } from '../../../../shared/infra/database/decimal';
import { Grupo } from '../../domain/grupo';

/*
  Linha do Prisma ⇄ entidade. O grupo é o agregado: a linha chega com os itens
  junto (include) e volta como duas listas, porque `createMany` não grava
  aninhado.

  Dinheiro: Decimal(12,2) ⇄ number. Rendimento: Decimal(6,4) ⇄ number, e a
  coluna NULA vira `undefined` — no domínio, campo opcional nunca é `null`.
*/

export type GrupoComItens = GrupoRow & { itens: ItemGrupoRow[] };

export function toDomain(row: GrupoComItens): Grupo {
  const rendimentoMensal = decimalToNumber(row.rendimentoMensal);
  return Grupo.restaurar({
    id: row.id,
    subscriberId: row.subscriberId,
    nome: row.nome,
    icone: row.icone,
    valor: decimalToNumber(row.valor),
    contaParaMeta: row.contaParaMeta,
    // a chave some quando não há rendimento; `rendimentoMensal: null` não existe no domínio
    ...(rendimentoMensal !== null ? { rendimentoMensal } : {}),
    doSistema: row.doSistema,
    ordem: row.ordem,
    criadoEm: row.criadoEm,
    // já vêm ordenados pelo `orderBy` do include: a ordem é posicional e é conteúdo, não detalhe
    itens: row.itens.map((item) => ({
      id: item.id,
      nome: item.nome,
      valor: decimalToNumber(item.valor),
      ordem: item.ordem,
    })),
  });
}

export function toPersistence(grupo: Grupo) {
  const g = grupo.toSnapshot();
  return {
    grupo: {
      id: g.id,
      subscriberId: g.subscriberId,
      nome: g.nome,
      icone: g.icone,
      valor: numberToDecimal(g.valor),
      contaParaMeta: g.contaParaMeta,
      rendimentoMensal: numberToDecimal(g.rendimentoMensal ?? null),
      doSistema: g.doSistema,
      ordem: g.ordem,
      criadoEm: g.criadoEm,
    },
    // o dono viaja no item também: a FK é composta (subscriber_id, grupo_id),
    // então item e grupo nunca discordam de dono
    itens: g.itens.map((item) => ({
      id: item.id,
      subscriberId: g.subscriberId,
      grupoId: g.id,
      nome: item.nome,
      valor: numberToDecimal(item.valor),
      ordem: item.ordem,
    })),
  };
}
