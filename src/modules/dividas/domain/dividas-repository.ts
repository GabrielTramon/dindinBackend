import type { Divida } from './divida';

export interface DividasRepository {
  /** ordem de criação; empate (mesmo instante, ex.: depois de replaceAll) desempata por id */
  listBySubscriber(subscriberId: string): Promise<Divida[]>;
  /** null também quando a dívida existe mas é de outro subscriber */
  findById(id: string, subscriberId: string): Promise<Divida | null>;
  countBySubscriber(subscriberId: string): Promise<number>;

  /**
   * Insere ou atualiza. Nunca sobrescreve dívida de outro dono com o mesmo id.
   * @throws BusinessRuleError quando o perfil do dono não existe (FK profile_id)
   * @throws ConflictError quando o id já é de uma dívida de outra pessoa
   */
  save(divida: Divida): Promise<void>;
  /** Só apaga se a dívida for do subscriber; inexistente não é erro. */
  delete(id: string, subscriberId: string): Promise<void>;

  /**
   * Troca a lista inteira do perfil (última gravação vence). Atômico: abre
   * transação própria se não houver uma aberta.
   *
   * No Prisma, trave a linha do perfil ANTES do delete:
   *   SELECT 1 FROM profiles WHERE subscriber_id = $1 FOR NO KEY UPDATE
   * Sem a trava, em READ COMMITTED, dois replaceAll simultâneos (duas abas, retry)
   * SOMAM as listas — o DELETE do segundo não enxerga o que o primeiro inseriu.
   * Provado em Postgres 18 real; o PGlite (uma sessão) não reproduz.
   *
   * Todas as dívidas precisam ter `subscriberId` igual ao parâmetro (senão lança Error, defeito do chamador).
   * @throws BusinessRuleError quando a lista não é vazia e o perfil não existe
   * @throws ConflictError quando algum id já é de dívida de outra pessoa (nada muda)
   */
  replaceAll(subscriberId: string, dividas: Divida[]): Promise<void>;
  deleteAllBySubscriber(subscriberId: string): Promise<void>;
}
