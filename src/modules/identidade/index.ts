// API pública do módulo identidade: só contratos. Adaptadores (Prisma, memória, HTTP) ficam em ./infra.
export { PREFIXO_TOKEN_CONSUMIDO, Subscriber, normalizarEmail } from './domain/subscriber';
export type { SubscriberProps } from './domain/subscriber';
export type { SubscribersRepository } from './domain/subscribers-repository';
