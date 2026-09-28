// API pública do módulo categorias: só contratos. Adaptadores (Prisma, memória, HTTP) ficam em ./infra.
export {
  Categoria,
  MAX_CATEGORIAS_PERSONALIZADAS,
  ORDEM_DOS_GRUPOS,
  TAMANHO_MAXIMO_NOME,
  normalizarNomeCategoria,
} from './domain/categoria';
export type { CategoriaProps, GrupoCategoria } from './domain/categoria';
export type { CategoriasRepository } from './domain/categorias-repository';
