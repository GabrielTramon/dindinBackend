import type { Page, PageRequest } from '../../../shared/application/pagination';
import type { CheckIn } from './check-in';

export interface CheckInsRepository {
  findByCompetencia(subscriberId: string, competencia: string): Promise<CheckIn | null>;
  /** da competência mais recente pra mais antiga; cursor = competência */
  list(subscriberId: string, page: PageRequest): Promise<Page<CheckIn>>;

  /**
   * Insere ou atualiza.
   * @throws ConflictError ao inserir quando já existe check-in dessa competência (job rodando duas vezes)
   */
  save(checkIn: CheckIn): Promise<void>;

  /**
   * Reserva o envio do e-mail: grava enviadoEm SÓ se ainda for nulo (compare-and-set).
   * @returns false quando outra execução do job já reservou — não envie.
   *
   * O job faz: reservar → enviar → se o envio falhar, releaseSendClaim. Duas
   * execuções sobrepostas nunca mandam o mesmo e-mail duas vezes.
   * No Prisma: updateMany({ where: { id, enviadoEm: null }, data: { enviadoEm } }) e count === 1.
   */
  claimSend(checkInId: string, sentAt: Date): Promise<boolean>;
  /** Desfaz a reserva quando o envio falhou, pra próxima execução tentar de novo. */
  releaseSendClaim(checkInId: string): Promise<void>;

  deleteAllBySubscriber(subscriberId: string): Promise<void>;
}
