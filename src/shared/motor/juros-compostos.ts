/*
  GERADO a partir de dindinFrontend/src/domain/juros-compostos.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { MESES_SIMULACAO_MAX } from "./config";
import type { EntradaExtra } from "./decimo-terceiro";
import { arredondar } from "./format";

/*
  Juros compostos, mês a mês. Uma conta só pra calculadora de juros compostos
  (/calculadoras/juros-compostos) e pro "E se você mantiver?" da tela do plano
  (simulador.ts): os dois nunca dão número diferente pros mesmos dados.

  A convenção é a das projeções do plano (marcos.ts, organizacao.ts): o saldo
  rende sobre o mês anterior e o depósito do mês entra no fim dele —
  `saldo = saldo × (1 + taxa) + depósito`. O valor inicial está lá no mês 0 e
  rende desde o mês 1. É a fórmula de sempre:
    total = inicial × (1 + i)^n + mensal × ((1 + i)^n − 1) / i

  Mês a mês (e não a fórmula fechada) porque o plano soma o 13º em dezembro, e
  porque a tabela mostra cada mês de qualquer jeito.

  Puro: sem React, sem data. Arredonda só na saída, no centavo.
*/

/** De quanto em quanto tempo a taxa informada vale. */
export type PeriodoTaxa = "mes" | "ano";

/** O tempo da calculadora: até 50 anos, o mesmo horizonte das projeções do plano. */
export const MAX_MESES_JUROS = MESES_SIMULACAO_MAX;

/** Valor estranho (negativo, NaN, Infinity) conta como nada: a tela nunca quebra no meio da digitação. */
function valido(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Tempo inválido (fração, negativo, acima do horizonte) vira um tempo que existe. */
export function mesesValidos(meses: number): number {
  if (!Number.isFinite(meses)) return 0;
  return Math.min(MAX_MESES_JUROS, Math.max(0, Math.round(meses)));
}

/**
 * A taxa ao mês. Ao ano, a EQUIVALENTE, não a proporcional: 12% ao ano rendem
 * 0,9489% ao mês (1,12^(1/12) − 1), não 1% — 1% ao mês, composto, dá 12,68% ao
 * ano. Com a proporcional, a calculadora prometeria mais do que a taxa paga.
 * `taxa` em fração: 0,12 = 12%.
 */
export function taxaAoMes(taxa: number, periodo: PeriodoTaxa): number {
  const t = valido(taxa);
  return periodo === "ano" ? (1 + t) ** (1 / 12) - 1 : t;
}

export interface EntradaJuros {
  /** o que já está guardado no mês 0, em reais */
  inicial?: number;
  /** o depósito de todo mês, em reais */
  mensal?: number;
  /** ao mês, em fração (0,01 = 1%); ausente = não rende */
  taxaMensal?: number;
  /** dinheiro a mais em meses certos (o 13º do plano); null = nada */
  extra?: EntradaExtra | null;
}

/** Como está o dinheiro no fim de um mês. */
export interface MesDeJuros {
  /** 0 = o começo (só o inicial) */
  mes: number;
  /** tudo o que entrou até aqui: o inicial + os depósitos */
  investido: number;
  /** o que os juros somaram até aqui */
  juros: number;
  /** investido + juros */
  total: number;
}

/**
 * Mês a mês, do mês 0 até `meses` (a lista tem `meses + 1` linhas). As contas
 * correm sem arredondar; cada linha sai arredondada no centavo, e os juros são
 * o total menos o investido JÁ arredondados — assim a linha fecha na soma.
 */
export function evolucaoMensal(e: EntradaJuros, meses: number): MesDeJuros[] {
  const inicial = valido(e.inicial);
  const mensal = valido(e.mensal);
  const taxa = valido(e.taxaMensal);
  const ate = mesesValidos(meses);

  const linha = (mes: number, investido: number, saldo: number): MesDeJuros => {
    const inv = arredondar(investido);
    const total = arredondar(saldo);
    return { mes, investido: inv, juros: arredondar(Math.max(0, total - inv)), total };
  };

  const linhas: MesDeJuros[] = [linha(0, inicial, inicial)];
  let saldo = inicial;
  let investido = inicial;
  for (let mes = 1; mes <= ate; mes++) {
    const deposito = mensal + (e.extra ? valido(e.extra(mes)) : 0);
    saldo = saldo * (1 + taxa) + deposito;
    investido += deposito;
    linhas.push(linha(mes, investido, saldo));
  }
  return linhas;
}

export interface ResultadoJuros {
  /** quanto tem no fim */
  final: number;
  /** quanto saiu do bolso: o inicial + os depósitos */
  investido: number;
  /** o que os juros somaram: final − investido */
  juros: number;
  /** a evolução inteira, mês 0 incluído */
  meses: MesDeJuros[];
}

/** O resultado da calculadora: o fim e o caminho até ele. */
export function jurosCompostos(e: EntradaJuros, meses: number): ResultadoJuros {
  const lista = evolucaoMensal(e, meses);
  const fim = lista[lista.length - 1];
  return { final: fim.total, investido: fim.investido, juros: fim.juros, meses: lista };
}

/**
 * As linhas da tabela por ano: o fim de cada ano e, quando o prazo não fecha o
 * ano (2 anos e 6 meses), o último mês também. Sem o mês 0.
 */
export function porAno(meses: MesDeJuros[]): MesDeJuros[] {
  const ultimo = meses[meses.length - 1];
  const anos = meses.filter((m) => m.mes > 0 && m.mes % 12 === 0);
  return ultimo && ultimo.mes > 0 && ultimo.mes % 12 !== 0 ? [...anos, ultimo] : anos;
}
