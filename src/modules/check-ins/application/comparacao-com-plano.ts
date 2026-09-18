import type { VersaoPlano, VersoesPlanoRepository } from '../../planos';
import { fimDaCompetencia, type CheckIn } from '../domain/check-in';

/*
  O mês real contra o plano. A comparação é com a versão do plano que VALIA
  NAQUELE MÊS (a mais nova gravada antes de o mês acabar), não com a última de
  hoje: com o seletor de ritmo a um toque, trocar o ritmo em setembro mudaria o
  veredito de agosto de "cumpriu" pra "não cumpriu". O passado não se reescreve.

  Quem se cadastrou depois do mês perguntado não tem versão nenhuma até lá — o
  e-mail do dia 1º pede justamente o mês que acabou. Nesse caso o repositório
  devolve a versão mais antiga da pessoa, e a comparação existe. Sem plano
  nenhum, não há com o que comparar (null).

  Modo corte: quando os custos passam da renda, o motor não pede aporte
  (aporte = 0) — a meta do mês é cortar gasto, não guardar. Por isso `cumpriu`
  vira guardadoReal >= 0, ou seja, qualquer resposta cumpre: o check-in não
  cobra guardar de quem o plano mandou cortar.

  Check-in aberto pelo job e ainda sem resposta: os valores planejados vêm
  (a tela mostra "o plano era guardar R$ X"), e guardadoReal, diferenca e
  cumpriu ficam null até a pessoa responder.
*/

export interface ComparacaoComPlano {
  aportePlanejado: number;
  livrePlanejado: number;
  guardadoReal: number | null;
  /** guardadoReal − aportePlanejado, com 2 casas; negativo = guardou menos que o plano */
  diferenca: number | null;
  cumpriu: boolean | null;
  versaoDoPlano: number;
}

export interface CheckInComComparacao {
  checkIn: CheckIn;
  comparacao: ComparacaoComPlano | null;
}

/**
 * Diferença em 2 casas. Os dois lados já têm no máximo 2 casas, mas a subtração
 * em ponto flutuante não (500,10 − 500,30 = −0,19999999999998863): toFixed volta
 * pro centavo mais próximo. O `|| 0` troca −0 por 0.
 */
function diferencaEmCentavos(real: number, planejado: number): number {
  return Number((real - planejado).toFixed(2)) || 0;
}

export function compararComPlano(checkIn: CheckIn, plano: VersaoPlano | null): ComparacaoComPlano | null {
  if (plano === null) return null;
  const { aporte, livre } = plano.resultado;
  const guardadoReal = checkIn.guardadoReal;
  const diferenca = guardadoReal === null ? null : diferencaEmCentavos(guardadoReal, aporte);
  return {
    aportePlanejado: aporte,
    livrePlanejado: livre,
    guardadoReal,
    diferenca,
    // a diferença arredondada decide: a tela nunca mostra "−R$ 0,00" com "não cumpriu"
    cumpriu: diferenca === null ? null : diferenca >= 0,
    versaoDoPlano: plano.versao,
  };
}

export async function comComparacao(
  versoesPlano: VersoesPlanoRepository,
  checkIn: CheckIn,
): Promise<CheckInComComparacao> {
  // limite exclusivo: o primeiro instante do mês seguinte no fuso do produto
  const plano = await versoesPlano.findEmVigorEm(checkIn.subscriberId, fimDaCompetencia(checkIn.competencia));
  return { checkIn, comparacao: compararComPlano(checkIn, plano) };
}
