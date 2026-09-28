/*
  GERADO a partir de dindinFrontend/src/domain/guardado-meta.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { MAX_GUARDADOS_NA_META, MAX_RENDIMENTO_MENSAL } from "./config";
import type { GuardadoNaMeta, Meta, Perfil, Plano } from "./types";
import { arredondar } from "./format";

/*
  O que a pessoa JÁ tem guardado e decidiu pôr na meta.

  É estoque, não fluxo: não entra na divisão do que sobra por mês. Mora em
  `Perfil.meta.guardados` (viaja com o perfil pra API), em potes — cada um com
  o seu valor e o seu rendimento (CDB, poupança…).

  Duas regras seguram a conta:
  - O mesmo real não é reserva E meta: o motor tira esse valor do guardado
    antes de montar fôlego e reserva (`guardadoNaMetaEfetivo`). Quem põe na
    meta mais do que passa da reserva vê a reserva voltar a faltar — é a
    consequência honesta da escolha, não uma trava.
  - A soma dos potes nunca passa do guardado do perfil. Não é o schema que
    garante (baixar o guardado depois faria o plano sumir no F5): é o motor e
    a projeção, que limitam na leitura (`metaComGuardadoEfetivo`).

  Puro: sem React, sem I/O.
*/

const centavos = (valor: number): number =>
  Number.isFinite(valor) ? Math.max(0, Math.round(arredondar(valor) * 100)) : 0;

const reais = (cent: number): number => arredondar(cent / 100);

export const NOME_GUARDADO_PADRAO = "Já guardado";

/** A soma dos potes do que já está guardado pra meta, sem limitar ao guardado. */
export function totalGuardadoNaMeta(meta: Meta | undefined): number {
  if (!meta?.guardados) return 0;
  return reais(meta.guardados.reduce((acc, g) => acc + centavos(g.valor), 0));
}

/** Quanto do guardado vai de fato pra meta: a soma dos potes, nunca mais que o guardado do perfil. */
export function guardadoNaMetaEfetivo(perfil: Pick<Perfil, "guardado" | "meta">): number {
  const guardado = Number.isFinite(perfil.guardado) ? Math.max(0, perfil.guardado) : 0;
  return reais(Math.min(centavos(guardado), centavos(totalGuardadoNaMeta(perfil.meta))));
}

/**
 * Reparte `total` entre os potes na proporção de hoje (centavos, maior resto),
 * mantendo id, nome e rendimento de cada um.
 *
 * - total ≤ 0 → [] ("nada vai pra meta");
 * - sem potes → um só, "Já guardado", com o total;
 * - potes todos em zero → o primeiro recebe tudo.
 */
export function comTotalGuardado(
  guardados: GuardadoNaMeta[] | undefined,
  total: number,
  novoId: () => string,
): GuardadoNaMeta[] {
  const alvo = centavos(total);
  if (alvo <= 0) return [];
  const lista = (guardados ?? []).slice(0, MAX_GUARDADOS_NA_META);
  if (lista.length === 0) return [{ id: novoId(), nome: NOME_GUARDADO_PADRAO, valor: reais(alvo) }];

  const pesos = lista.map((g) => centavos(g.valor));
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (soma <= 0) return lista.map((g, i) => ({ ...g, valor: i === 0 ? reais(alvo) : 0 }));

  const exatos = pesos.map((p) => (p * alvo) / soma);
  const partes = exatos.map((e) => Math.floor(e));
  let faltam = alvo - partes.reduce((a, b) => a + b, 0);
  const ordem = exatos
    .map((e, i) => ({ i, resto: e - Math.floor(e) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of ordem) {
    if (faltam <= 0) break;
    partes[i] += 1;
    faltam -= 1;
  }
  return lista.map((g, i) => ({ ...g, valor: reais(partes[i]) }));
}

/**
 * A meta com os potes limitados ao guardado do perfil, na proporção: a
 * projeção nunca conta dinheiro que a pessoa não tem. Dentro do guardado,
 * devolve a MESMA meta.
 */
export function metaComGuardadoEfetivo(meta: Meta, guardado: number): Meta {
  const efetivo = guardadoNaMetaEfetivo({ guardado, meta });
  if (centavos(efetivo) === centavos(totalGuardadoNaMeta(meta))) return meta;
  // a lista não está vazia aqui (o total passou do guardado), então nenhum id novo é gerado
  return { ...meta, guardados: comTotalGuardado(meta.guardados, efetivo, () => "guardado") };
}

/** Os saldos com que a meta começa: valor e taxa ao mês de cada pote com dinheiro. */
export function saldosIniciaisDaMeta(meta: Meta): { valor: number; taxa: number }[] {
  return (meta.guardados ?? [])
    .map((g) => ({
      valor: reais(centavos(g.valor)),
      taxa:
        g.rendimentoMensal !== undefined && Number.isFinite(g.rendimentoMensal)
          ? Math.min(Math.max(0, g.rendimentoMensal), MAX_RENDIMENTO_MENSAL)
          : 0,
    }))
    .filter((s) => s.valor > 0);
}

/** As escolhas da pergunta "o que você já tem entra na meta?", com os números de agora. */
export interface OpcoesGuardadoNaMeta {
  /** tudo o que a pessoa tem guardado */
  guardado: number;
  /** o alvo da reserva de emergência (o fôlego está dentro dele) */
  reserva: number;
  /** o que passa da reserva: dá pra usar na meta sem mexer nela */
  excedente: number;
}

/** O alvo da reserva não depende do guardado: qualquer plano do mesmo perfil serve. */
export function opcoesGuardadoNaMeta(plano: Plano): OpcoesGuardadoNaMeta {
  const guardado = reais(centavos(plano.perfil.guardado));
  const reserva = reais(centavos(plano.reserva.alvo));
  return { guardado, reserva, excedente: reais(Math.max(0, centavos(guardado) - centavos(reserva))) };
}
