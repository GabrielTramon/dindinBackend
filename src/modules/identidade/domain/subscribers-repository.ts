import type { Page, PageRequest } from '../../../shared/application/pagination';
import type { Subscriber } from './subscriber';

export interface SubscribersRepository {
  findById(id: string): Promise<Subscriber | null>;
  /** o e-mail já normalizado (normalizarEmail) */
  findByEmail(email: string): Promise<Subscriber | null>;
  findByTokenHash(tokenHash: string): Promise<Subscriber | null>;

  /**
   * Insere ou atualiza a linha — inteira, MENOS a senha e a versaoSessao numa linha
   * que já existe: as duas só mudam por savePassword/savePasswordReset. Assim, gravar
   * uma entidade lida antes (descadastro, link novo) nunca desfaz uma troca de senha
   * feita no meio — nem devolve a validade às sessões que ela encerrou.
   * @throws ConflictError quando o e-mail já pertence a outro subscriber (corrida entre dois cadastros)
   */
  save(subscriber: Subscriber): Promise<void>;

  /**
   * Grava o consumo do link SÓ se a linha ainda tiver `usedTokenHash`
   * (compare-and-set). Atualiza apenas token, tokenExpiraEm, emailVerificadoEm e
   * atualizadoEm, a partir da entidade já consumida — não desfaz um descadastro,
   * uma senha nova nem um link novo gravados ao mesmo tempo.
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
   * O consumo do link "Criar uma senha nova" junto com a senha: o mesmo
   * compare-and-set de `saveMagicLinkConsumption`, gravando também o hash da
   * senha e a versaoSessao (que a senha nova subiu). Numa escrita só: o link não pode ser gasto sem a senha mudar, nem a
   * senha mudar por um link que outro pedido já gastou.
   *
   * @returns false quando outro pedido já consumiu ou trocou o token (a senha NÃO muda)
   */
  savePasswordReset(subscriber: Subscriber, usedTokenHash: string): Promise<boolean>;

  /**
   * Grava só o hash da senha, a versaoSessao e atualizadoEm (troca de senha com a
   * sessão). Não regrava a linha inteira: um link emitido ou um descadastro no meio
   * continuam.
   *
   * @returns false quando a conta não existe mais (excluída no meio do pedido)
   */
  savePassword(subscriber: Subscriber): Promise<boolean>;

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
