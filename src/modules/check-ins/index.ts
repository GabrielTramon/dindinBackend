// API pública do módulo check-ins: só contratos. Adaptadores (Prisma, memória, HTTP) ficam em ./infra.
export { CheckIn, FUSO_DO_PRODUTO, competenciaAnterior, competenciaDe, competenciaValida } from './domain/check-in';
export type { CheckInProps, RespostaCheckIn } from './domain/check-in';
export type { CheckInsRepository } from './domain/check-ins-repository';
