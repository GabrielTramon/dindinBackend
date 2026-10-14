/*
  GERADO a partir de dindinFrontend/src/domain/simulador.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { MAX_RENDIMENTO_MENSAL } from "./config";
import type { EntradaExtra } from "./decimo-terceiro";
import { evolucaoMensal, MAX_MESES_JUROS, mesesValidos } from "./juros-compostos";

/*
  "E se você mantiver?" — quanto vira guardar um valor por mês durante um tempo,
  a partir do que já está guardado.

  É um simulador, não o plano: a pessoa muda o que já tem, o valor, o
  rendimento e o tempo pra comparar, e nada disso volta pro perfil. Por isso não
  passa pela cascata (dívida, reserva, meta): é a conta simples de "tenho X,
  guardo Y por mês, rendendo Z".

  A conta é a de juros-compostos.ts (a mesma da calculadora de juros
  compostos), com a convenção de mês das projeções do plano. O 13º entra no mês
  em que cai (decimo-terceiro.ts), como no plano.

  O rendimento é o que a pessoa digitou (no Guardar ou aqui), até 5% ao mês; o
  app nunca sugere taxa. Puro: sem React, sem data (o 13º já chega como EntradaExtra).
*/

/** Os tempos da tabela, em meses: 6 meses, 1, 2, 5, 10 e 20 anos. */
export const PERIODOS_DA_TABELA = [6, 12, 24, 60, 120, 240] as const;

/** O maior tempo que dá pra simular: o mesmo horizonte das projeções (50 anos). */
export const MAX_MESES_SIMULADOS = MAX_MESES_JUROS;

export interface ParametrosSimulacao {
  /** o que já está guardado hoje, em reais; ausente = começa do zero */
  inicial?: number;
  /** quanto guarda por mês, em reais */
  porMes: number;
  /** ao mês, 0,8% = 0.008; ausente = não rende */
  taxaMensal?: number;
  /** o 13º, quando entra (entradasDoDecimo); null = não entra */
  decimo?: EntradaExtra | null;
}

export interface SimulacaoNoTempo {
  meses: number;
  /** tudo o que foi guardado: o que já tinha + os meses + os 13º */
  guardado: number;
  /** o que os juros somaram; 0 sem rendimento */
  rendimento: number;
  /** guardado + rendimento */
  total: number;
}

const taxaValida = (n: number | undefined): number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.min(n, MAX_RENDIMENTO_MENSAL) : 0;

/**
 * Quanto vira em cada tempo pedido, numa passada só: a evolução mês a mês até o
 * maior tempo, e os tempos da tabela são paradas no caminho. Devolve na ordem
 * dos `periodos` recebidos.
 */
export function simularNoTempo(p: ParametrosSimulacao, periodos: readonly number[]): SimulacaoNoTempo[] {
  const alvos = periodos.map(mesesValidos);
  const evolucao = evolucaoMensal(
    { inicial: p.inicial, mensal: p.porMes, taxaMensal: taxaValida(p.taxaMensal), extra: p.decimo },
    Math.max(0, ...alvos),
  );
  return alvos.map((m) => {
    const { investido, juros, total } = evolucao[m];
    return { meses: m, guardado: investido, rendimento: juros, total };
  });
}

/** Um tempo só: "e em 3 anos?". */
export function guardarPor(p: ParametrosSimulacao, meses: number): SimulacaoNoTempo {
  return simularNoTempo(p, [meses])[0];
}
