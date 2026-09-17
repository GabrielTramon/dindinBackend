import type { PerfilDoMotor } from '../../application/perfil-do-motor';
import type { Perfil } from '../../domain/perfil';

/*
  Perfil como o cliente vê. Nunca o dono: a sessão já diz de quem é. O perfil
  completo é copiado campo a campo, no formato do motor — o mesmo que o
  frontend guarda no localStorage —, pra nenhum campo interno vazar se a
  estrutura montada ganhar algo no futuro.
*/

export function presentPerfil(perfil: Perfil) {
  return {
    rendaMensal: perfil.rendaMensal,
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
