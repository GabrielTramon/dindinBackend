/*
  GERADO a partir de dindinFrontend/src/domain/simulador.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { MAX_RENDIMENTO_MENSAL, MESES_SIMULACAO_MAX } from "./config";
import type { EntradaExtra } from "./decimo-terceiro";
import { arredondar } from "./format";

/*
  "E se você mantiver?" — quanto vira guardar um valor por mês durante um tempo.

  É um simulador, não o plano: a pessoa muda o valor, o rendimento e o tempo
  pra comparar, e nada disso volta pro perfil. Por isso não passa pela cascata
  (dívida, reserva, meta): é a conta simples de "guardei X por mês, rendendo Y".

  A convenção de mês é a mesma das projeções do plano (marcos.ts,
  organizacao.ts): o saldo rende sobre o mês anterior e o depósito entra no fim
  do mês — `saldo = saldo × (1 + taxa) + depósito`. O 13º entra no mês em que
  cai (decimo-terceiro.ts), como no plano.

  O rendimento é o que a pessoa digitou (no Guardar ou aqui); o app nunca
  sugere taxa. Puro: sem React, sem data (o 13º já chega como EntradaExtra).
*/

/** Os tempos da tabela, em meses: 6 meses, 1, 2, 5, 10 e 20 anos. */
export const PERIODOS_DA_TABELA = [6, 12, 24, 60, 120, 240] as const;

/** O maior tempo que dá pra simular: o mesmo horizonte das projeções (50 anos). */
export const MAX_MESES_SIMULADOS = MESES_SIMULACAO_MAX;

export interface ParametrosSimulacao {
  /** quanto guarda por mês, em reais */
  porMes: number;
  /** ao mês, 0,8% = 0.008; ausente = não rende */
  taxaMensal?: number;
  /** o 13º, quando entra (entradasDoDecimo); null = não entra */
  decimo?: EntradaExtra | null;
}

export interface SimulacaoNoTempo {
  meses: number;
  /** tudo o que foi depositado (os meses + os 13º) */
  guardado: number;
  /** o que os juros somaram; 0 sem rendimento */
  rendimento: number;
  /** guardado + rendimento */
  total: number;
}

const valido = (n: number | undefined): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/** Tempo inválido (fração, negativo, acima do horizonte) vira um tempo que existe. */
function mesesValidos(meses: number): number {
  if (!Number.isFinite(meses)) return 0;
  return Math.min(MAX_MESES_SIMULADOS, Math.max(0, Math.round(meses)));
}

/**
 * Quanto vira em cada tempo pedido, numa passada só: a conta é mês a mês (o
 * 13º não cabe na fórmula fechada), e os tempos da tabela são paradas no
 * caminho. Devolve na ordem dos `periodos` recebidos.
 */
export function simularNoTempo(p: ParametrosSimulacao, periodos: readonly number[]): SimulacaoNoTempo[] {
  const porMes = valido(p.porMes);
  const taxa = Math.min(valido(p.taxaMensal), MAX_RENDIMENTO_MENSAL);
  const alvos = periodos.map(mesesValidos);
  const ate = Math.max(0, ...alvos);

  const paradas = new Map<number, SimulacaoNoTempo>();
  const parar = (meses: number, guardado: number, saldo: number) => {
    const g = arredondar(guardado);
    const total = arredondar(saldo);
    paradas.set(meses, { meses, guardado: g, rendimento: arredondar(Math.max(0, total - g)), total });
  };

  let saldo = 0;
  let guardado = 0;
  parar(0, 0, 0);
  for (let mes = 1; mes <= ate; mes++) {
    const deposito = porMes + (p.decimo ? valido(p.decimo(mes)) : 0);
    saldo = saldo * (1 + taxa) + deposito;
    guardado += deposito;
    parar(mes, guardado, saldo);
  }
  return alvos.map((m) => paradas.get(m) as SimulacaoNoTempo);
}

/** Um tempo só: "e em 3 anos?". */
export function guardarPor(p: ParametrosSimulacao, meses: number): SimulacaoNoTempo {
  return simularNoTempo(p, [meses])[0];
}
