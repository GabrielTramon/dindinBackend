import type { Grupo } from './grupo';

export interface GruposRepository {
  /**
   * A árvore da pessoa, na ordem posicional gravada (`ordem`, depois `id` pra
   * desempatar) — e os itens de cada grupo na ordem deles. Sem nada organizado,
   * devolve lista vazia: árvore vazia é um estado válido, não é "não encontrado".
   */
  listBySubscriber(subscriberId: string): Promise<Grupo[]>;

  countBySubscriber(subscriberId: string): Promise<number>;

  /**
   * Troca a árvore inteira da pessoa (última gravação vence). Atômico: abre
   * transação própria se não houver uma aberta.
   *
   * No Prisma, trave a linha do subscriber ANTES do delete:
   *   SELECT 1 FROM subscribers WHERE id = $1 FOR NO KEY UPDATE
   * Sem a trava, em READ COMMITTED, dois PUTs simultâneos (duas abas, um retry)
   * somam as árvores: o DELETE do segundo não enxerga o que o primeiro inseriu,
   * e a pessoa fica com o dobro dos grupos que o servidor acabou de validar.
   * PGlite é uma sessão só e não reproduz a corrida.
   *
   * @throws ConflictError com id de grupo (ou de item dentro do grupo) repetido
   */
  replaceAll(subscriberId: string, grupos: Grupo[]): Promise<void>;

  /** Exclusão da conta (LGPD): itens antes de grupos — o modo memória não tem cascade. */
  deleteAllBySubscriber(subscriberId: string): Promise<void>;
}
