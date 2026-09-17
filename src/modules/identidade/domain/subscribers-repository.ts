import type { Page, PageRequest } from '../../../shared/application/pagination';
import type { Subscriber } from './subscriber';

export interface SubscribersRepository {
  findById(id: string): Promise<Subscriber | null>;
  /** o e-mail já normalizado (normalizarEmail) */
  findByEmail(email: string): Promise<Subscriber | null>;
  findByTokenHash(tokenHash: string): Promise<Subscriber | null>;

  /**
   * Insere ou atualiza a linha inteira.
   * @throws ConflictError quando o e-mail já pertence a outro subscriber (corrida entre dois pedidos de link)
   */
  save(subscriber: Subscriber): Promise<void>;

  /**
   * Grava o consumo do link mágico SÓ se a linha ainda tiver `usedTokenHash`
   * (compare-and-set). Atualiza apenas token, tokenExpiraEm, emailVerificadoEm e
   * atualizadoEm, a partir da entidade já consumida — não desfaz um descadastro
   * nem um link novo emitidos ao mesmo tempo.
   *
   * @returns false quando outro pedido já consumiu ou trocou o token: o caso de uso
   *          responde UnauthorizedError e NÃO emite sessão.
   *
   * No Prisma: updateMany({ where: { id, token: usedTokenHash } }) e count === 1.
   * Em memória: comparar e gravar sem nenhum await no meio.
   * A garantia sob concorrência vem do WHERE no banco; o PGlite (uma sessão) não reproduz a corrida.
   */
  saveMagicLinkConsumption(subscriber: Subscriber, usedTokenHash: string): Promise<boolean>;

  /**
   * Remove o subscriber. No Postgres, o ON DELETE CASCADE levaria perfil, gastos,
   * dívidas, categorias, planos, metas e check-ins — mas privacidade/ExcluirConta
   * apaga cada módulo explicitamente antes, na ordem das FKs, pra o modo memória
   * se comportar igual.
   */
  delete(id: string): Promise<void>;

  /** Ativos e com e-mail verificado, em ordem estável de id — o público do e-mail mensal. */
  listEmailable(page: PageRequest): Promise<Page<Subscriber>>;
}
