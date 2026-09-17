import type { Perfil } from './perfil';

export interface PerfisRepository {
  findBySubscriberId(subscriberId: string): Promise<Perfil | null>;
  /**
   * A pessoa já respondeu o perfil? Consulta só a chave. Tem a mesma forma do
   * PerfilGateway de gastos-fixos e dividas: o main pode ligar este repositório direto.
   */
  exists(subscriberId: string): Promise<boolean>;
  /**
   * insere ou atualiza (um perfil por subscriber)
   * @throws UnauthorizedError quando a conta não existe mais (FK subscriber_id): foi excluída no meio do pedido
   */
  save(perfil: Perfil): Promise<void>;
  /** Idempotente. No banco, gastos fixos e dívidas do perfil saem junto (onDelete: Cascade). */
  delete(subscriberId: string): Promise<void>;
}
