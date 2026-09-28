import type { CheckInComComparacao, ComparacaoComPlano } from '../../application/comparacao-com-plano';
import type { CheckIn } from '../../domain/check-in';

/*
  Check-in como o cliente vê. Não expõe dono, id interno nem criadoEm: a
  competência já identifica o check-in dentro da conta (GET /check-ins/:competencia).
  Valores e datas ficam null enquanto a pessoa não respondeu ou o e-mail não saiu.
*/

export function presentCheckIn(checkIn: CheckIn) {
  return {
    competencia: checkIn.competencia,
    rendaReal: checkIn.rendaReal,
    gastoReal: checkIn.gastoReal,
    guardadoReal: checkIn.guardadoReal,
    respondidoEm: checkIn.respondidoEm?.toISOString() ?? null,
    enviadoEm: checkIn.enviadoEm?.toISOString() ?? null,
  };
}

export function presentComparacao(comparacao: ComparacaoComPlano | null) {
  if (comparacao === null) return null;
  return {
    aportePlanejado: comparacao.aportePlanejado,
    livrePlanejado: comparacao.livrePlanejado,
    guardadoReal: comparacao.guardadoReal,
    diferenca: comparacao.diferenca,
    cumpriu: comparacao.cumpriu,
    versaoDoPlano: comparacao.versaoDoPlano,
  };
}

/** Um mês com a comparação com o plano atual (null quando a pessoa não gerou plano). */
export function presentCheckInComComparacao({ checkIn, comparacao }: CheckInComComparacao) {
  return { ...presentCheckIn(checkIn), comparacao: presentComparacao(comparacao) };
}

export type CheckInResponse = ReturnType<typeof presentCheckIn>;
export type CheckInComComparacaoResponse = ReturnType<typeof presentCheckInComComparacao>;
