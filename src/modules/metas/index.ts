// API pública do módulo metas: só contratos. Adaptadores (Prisma, memória, HTTP) ficam em ./infra.
export { MAX_METAS, Meta, PRAZO_MAXIMO_MESES, TAMANHO_MAXIMO_NOME_META } from './domain/meta';
export type { DadosMeta, MetaProps } from './domain/meta';
export type { MetasRepository } from './domain/metas-repository';
