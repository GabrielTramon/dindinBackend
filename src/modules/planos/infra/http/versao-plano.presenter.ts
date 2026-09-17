import type { PlanoDoMotor, VersaoPlano } from '../../domain/versao-plano';

/*
  Plano como o cliente vê. Não expõe dono nem id interno: a versão já
  identifica o plano dentro da conta (GET /planos/:versao).

  `entrada` é o perfil que entrou no motor e `resultado` é o plano no mesmo
  formato que o motor do frontend devolve — a tela renderiza sem conversão.
*/

export function presentVersaoPlano(versao: VersaoPlano) {
  return {
    versao: versao.versao,
    criadoEm: versao.criadoEm.toISOString(),
    entrada: versao.inputSnap,
    resultado: versao.resultado,
  };
}

/** Uma linha do histórico: o suficiente pra listar sem mandar o plano inteiro. */
export function presentItemHistoricoPlano(versao: VersaoPlano) {
  const resultado = versao.resultado;
  return {
    versao: versao.versao,
    criadoEm: versao.criadoEm.toISOString(),
    degrau: resultado.degrau,
    modoCorte: resultado.modoCorte,
    aporte: resultado.aporte,
    livre: resultado.livre,
    decisao: resultado.decisao.titulo,
  };
}

export function presentSimulacaoPlano(plano: PlanoDoMotor) {
  return { resultado: plano };
}

export type VersaoPlanoResponse = ReturnType<typeof presentVersaoPlano>;
export type ItemHistoricoPlanoResponse = ReturnType<typeof presentItemHistoricoPlano>;
