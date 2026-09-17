// API pública do módulo dividas: só contratos. Adaptadores (Prisma, memória, HTTP) ficam em ./infra.
export { Divida, MAX_DIVIDAS } from './domain/divida';
export type { DadosDivida, DividaProps, TipoDivida } from './domain/divida';
export type { DividasRepository } from './domain/dividas-repository';
export type { PerfilGateway as DividasPerfilGateway } from './application/ports';
