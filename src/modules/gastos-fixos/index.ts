// API pública do módulo gastos-fixos: só contratos. Adaptadores (Prisma, memória, HTTP) ficam em ./infra.
export { GastoFixo, MAX_GASTOS_FIXOS } from './domain/gasto-fixo';
export type { GastoFixoProps } from './domain/gasto-fixo';
export type { GastosFixosRepository } from './domain/gastos-fixos-repository';
export type { PerfilGateway as GastosFixosPerfilGateway } from './application/ports';
