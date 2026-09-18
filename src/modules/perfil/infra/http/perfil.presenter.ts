import type { Meta } from '../../../../shared/motor/types';
import type { PerfilDoMotor } from '../../application/perfil-do-motor';
import type { Perfil } from '../../domain/perfil';

/*
  Perfil como o cliente vê. Nunca o dono: a sessão já diz de quem é. O perfil
  completo é copiado campo a campo, no formato do motor — o mesmo que o
  frontend guarda no localStorage —, pra nenhum campo interno vazar se a
  estrutura montada ganhar algo no futuro.

  Campo opcional ausente NÃO vira chave: é o cliente que regrava o perfil de
  volta (PUT /perfil/completo), e uma chave a mais ou a menos aqui muda o
  inputSnap do plano. As DUAS funções levam os campos novos — se só uma levar,
  a escolha some no F5 pela outra porta.
*/

function presentMeta(meta: Meta) {
  return { tipo: meta.tipo, ...(meta.nome !== undefined ? { nome: meta.nome } : {}), valorAlvo: meta.valorAlvo };
}

export function presentPerfil(perfil: Perfil) {
  const meta = perfil.meta;
  return {
    rendaMensal: perfil.rendaMensal,
    ...(perfil.rendaInformada !== undefined ? { rendaInformada: perfil.rendaInformada } : {}),
    ...(perfil.salarioBruto !== undefined ? { salarioBruto: perfil.salarioBruto } : {}),
    ...(perfil.dependentes !== undefined ? { dependentes: perfil.dependentes } : {}),
    ...(perfil.competenciaTabela !== undefined ? { competenciaTabela: perfil.competenciaTabela } : {}),
    ...(perfil.ritmo !== undefined ? { ritmo: perfil.ritmo } : {}),
    ...(perfil.aporteEscolhido !== undefined ? { aporteEscolhido: perfil.aporteEscolhido } : {}),
    ...(perfil.aporteEscolhido !== undefined ? { aporteEscolhido: perfil.aporteEscolhido } : {}),
    ...(meta !== undefined ? { meta: presentMeta(meta) } : {}),
    tipoRenda: perfil.tipoRenda,
    idade: perfil.idade,
    moradia: perfil.moradia,
    custoMoradia: perfil.custoMoradia,
    guardado: perfil.guardado,
    atualizadoEm: perfil.atualizadoEm.toISOString(),
  };
}

export function presentPerfilCompleto(perfil: PerfilDoMotor): PerfilDoMotor {
  return {
    rendaMensal: perfil.rendaMensal,
    ...(perfil.rendaInformada !== undefined ? { rendaInformada: perfil.rendaInformada } : {}),
    ...(perfil.salarioBruto !== undefined ? { salarioBruto: perfil.salarioBruto } : {}),
    ...(perfil.dependentes !== undefined ? { dependentes: perfil.dependentes } : {}),
    ...(perfil.competenciaTabela !== undefined ? { competenciaTabela: perfil.competenciaTabela } : {}),
    ...(perfil.ritmo !== undefined ? { ritmo: perfil.ritmo } : {}),
    ...(perfil.meta !== undefined ? { meta: presentMeta(perfil.meta) } : {}),
    tipoRenda: perfil.tipoRenda,
    idade: perfil.idade,
    moradia: perfil.moradia,
    custoMoradia: perfil.custoMoradia,
    guardado: perfil.guardado,
    gastosFixos: perfil.gastosFixos.map((gasto) => ({
      categoria: gasto.categoria,
      ...(gasto.nome !== undefined ? { nome: gasto.nome } : {}),
      valor: gasto.valor,
    })),
    dividas: perfil.dividas.map((divida) => ({
      tipo: divida.tipo,
      saldo: divida.saldo,
      ...(divida.parcela !== undefined ? { parcela: divida.parcela } : {}),
      ...(divida.taxaAnual !== undefined ? { taxaAnual: divida.taxaAnual } : {}),
    })),
  };
}

export type PerfilResponse = ReturnType<typeof presentPerfil>;
