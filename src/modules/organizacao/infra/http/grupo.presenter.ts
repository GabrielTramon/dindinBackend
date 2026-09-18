import type { Grupo } from '../../domain/grupo';

/*
  A árvore como o cliente vê — e é EXATAMENTE a forma que ele manda no PUT: o
  que volta do GET pode ser regravado sem tradução nenhuma, que é o que faz a
  cópia do servidor e a do localStorage não divergirem.

  Por isso ficam de fora `subscriberId` (dono), `ordem` (a posição já é a da
  lista) e `criadoEm` (marca a gravação, não interessa à tela). E `rendimentoMensal`
  some quando não há rendimento, em vez de virar `null`.
*/

export function presentGrupo(grupo: Grupo) {
  return {
    id: grupo.id,
    nome: grupo.nome,
    icone: grupo.icone,
    valor: grupo.valor,
    contaParaMeta: grupo.contaParaMeta,
    ...(grupo.rendimentoMensal !== undefined ? { rendimentoMensal: grupo.rendimentoMensal } : {}),
    doSistema: grupo.doSistema,
    itens: grupo.itens.map((item) => ({ id: item.id, nome: item.nome, valor: item.valor })),
  };
}

/** `{ grupos }` nos dois sentidos: o corpo da resposta é o corpo do próximo PUT. */
export function presentOrganizacao(grupos: readonly Grupo[]) {
  return { grupos: grupos.map(presentGrupo) };
}

export type GrupoResponse = ReturnType<typeof presentGrupo>;
export type OrganizacaoResponse = ReturnType<typeof presentOrganizacao>;
