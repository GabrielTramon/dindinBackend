import type { GastoFixo } from './gasto-fixo';

export interface GastosFixosRepository {
  /** do maior valor pro menor; empate pela data de criação, depois por id */
  listBySubscriber(subscriberId: string): Promise<GastoFixo[]>;
  /** null também quando o gasto existe mas é de outro subscriber */
  findById(id: string, subscriberId: string): Promise<GastoFixo | null>;
  countBySubscriber(subscriberId: string): Promise<number>;
  /** @param ignoreId desconsidera esse gasto (útil ao editar) */
  existsInCategory(subscriberId: string, categoriaId: string, ignoreId?: string): Promise<boolean>;
  /** há gasto de QUALQUER pessoa nessa categoria? — liga o isInUse de categorias */
  existsForCategory(categoriaId: string): Promise<boolean>;

  /** @throws ConflictError quando já existe gasto nessa categoria pro mesmo perfil */
  save(gasto: GastoFixo): Promise<void>;
  delete(id: string, subscriberId: string): Promise<void>;

  /**
   * Troca a lista inteira do perfil (última gravação vence). Atômico: abre
   * transação própria se não houver uma aberta.
   *
   * No Prisma, trave a linha do perfil ANTES do delete:
   *   SELECT 1 FROM profiles WHERE subscriber_id = $1 FOR NO KEY UPDATE
   * Sem a trava, em READ COMMITTED, dois replaceAll simultâneos somam as listas
   * (ou batem no unique de categoria). PGlite não reproduz.
   */
  replaceAll(subscriberId: string, gastos: GastoFixo[]): Promise<void>;
  deleteAllBySubscriber(subscriberId: string): Promise<void>;
}
