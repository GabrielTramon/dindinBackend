// API pública do módulo perfil: só contratos. Adaptadores (Prisma, memória, HTTP) ficam em ./infra.
export { Perfil } from './domain/perfil';
export type { DadosPerfil, PerfilProps } from './domain/perfil';
export type { PerfisRepository } from './domain/perfis-repository';
