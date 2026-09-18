// API pública do módulo organizacao: só contratos. Adaptadores (Prisma, memória, HTTP) ficam em ./infra.
export {
  CASAS_RENDIMENTO,
  Grupo,
  MAX_GRUPOS,
  MAX_ITENS_POR_GRUPO,
  MAX_RENDIMENTO_MENSAL,
  TAMANHO_MAXIMO_NOME,
  validarOrganizacao,
} from './domain/grupo';
export type { CriarGrupoInput, GrupoProps, ItemGrupoInput, ItemGrupoProps } from './domain/grupo';
export type { GruposRepository } from './domain/grupos-repository';
