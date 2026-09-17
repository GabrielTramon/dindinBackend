/*
  GERADO a partir de dindinFrontend/src/domain/projecao.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { TAXA_LIVRE_RISCO_ANUAL } from "./config";
import { taxaMensal } from "./motor";
import { arredondar } from "./format";

/*
  Projeções de meta: juros compostos com aporte mensal.
  Usadas pelo simulador de metas (Fase A3) e pelas calculadoras públicas.
  Aporte entra no fim de cada mês, depois do rendimento — convenção conservadora.
*/

export interface ParametrosProjecao {
  saldoInicial?: number;
  aporteMensal: number;
  /** taxa anual de rendimento; padrão = taxa livre de risco */
  taxaAnual?: number;
}

/** Saldo após `meses`, com rendimento composto e aporte mensal. */
export function projetarSaldo(p: ParametrosProjecao, meses: number): number {
  const i = taxaMensal(p.taxaAnual ?? TAXA_LIVRE_RISCO_ANUAL);
  let saldo = p.saldoInicial ?? 0;
  for (let m = 0; m < meses; m++) {
    saldo = saldo * (1 + i) + p.aporteMensal;
  }
  return arredondar(saldo);
}

/**
 * Quantos meses até `valorAlvo`. null se nunca chega (aporte zero e saldo
 * abaixo do alvo) ou se passar de 100 anos.
 */
export function mesesParaMeta(p: ParametrosProjecao, valorAlvo: number): number | null {
  const i = taxaMensal(p.taxaAnual ?? TAXA_LIVRE_RISCO_ANUAL);
  let saldo = p.saldoInicial ?? 0;
  // compara em centavos, como projetarSaldo mostra: a soma em float fica 1e-12 abaixo do alvo e "perde" o mês
  if (arredondar(saldo) >= valorAlvo) return 0;
  if (p.aporteMensal <= 0 && i <= 0) return null;
  for (let m = 1; m <= 1200; m++) {
    saldo = saldo * (1 + i) + p.aporteMensal;
    if (arredondar(saldo) >= valorAlvo) return m;
  }
  return null;
}

/** Aporte mensal necessário pra chegar em `valorAlvo` em `meses`. */
export function aporteParaMeta(
  valorAlvo: number,
  meses: number,
  opts: { saldoInicial?: number; taxaAnual?: number } = {},
): number {
  if (meses <= 0) return Math.max(0, valorAlvo - (opts.saldoInicial ?? 0));
  const i = taxaMensal(opts.taxaAnual ?? TAXA_LIVRE_RISCO_ANUAL);
  const saldo0 = opts.saldoInicial ?? 0;
  const fator = (1 + i) ** meses;
  const faltaFutura = valorAlvo - saldo0 * fator;
  if (faltaFutura <= 0) return 0;
  // série uniforme: FV = A * ((1+i)^n - 1) / i
  const aporte = i === 0 ? faltaFutura / meses : (faltaFutura * i) / (fator - 1);
  // arredonda pra CIMA no centavo: arredondado pra baixo, o aporte não chega no alvo em `meses`
  return Math.max(0, Math.ceil(aporte * 100 - 1e-6) / 100);
}

export interface PontoProjecao {
  mes: number;
  saldo: number;
  aportado: number;
  rendimento: number;
}

/** Série mês a mês, pra gráfico. */
export function serieProjecao(p: ParametrosProjecao, meses: number): PontoProjecao[] {
  const i = taxaMensal(p.taxaAnual ?? TAXA_LIVRE_RISCO_ANUAL);
  const saldo0 = p.saldoInicial ?? 0;
  const serie: PontoProjecao[] = [{ mes: 0, saldo: arredondar(saldo0), aportado: arredondar(saldo0), rendimento: 0 }];
  let saldo = saldo0;
  let aportado = saldo0;
  for (let m = 1; m <= meses; m++) {
    saldo = saldo * (1 + i) + p.aporteMensal;
    aportado += p.aporteMensal;
    // rendimento sai dos valores já arredondados, senão saldo − aportado difere dele por 1 centavo
    const saldoArredondado = arredondar(saldo);
    const aportadoArredondado = arredondar(aportado);
    serie.push({
      mes: m,
      saldo: saldoArredondado,
      aportado: aportadoArredondado,
      rendimento: arredondar(saldoArredondado - aportadoArredondado),
    });
  }
  return serie;
}
