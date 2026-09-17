// API pública do módulo planos: só contratos. Adaptadores (Prisma, memória, HTTP) ficam em ./infra.
export { VersaoPlano } from './domain/versao-plano';
export type { PerfilDoMotor, PlanoDoMotor, VersaoPlanoProps } from './domain/versao-plano';
export type { VersoesPlanoRepository } from './domain/versoes-plano-repository';
export type { PerfilDoMotorReader } from './application/ports';
