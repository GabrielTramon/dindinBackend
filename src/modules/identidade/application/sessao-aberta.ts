import type { IssuedToken } from '../../../shared/application/ports';
import type { Subscriber } from '../domain/subscriber';

/**
 * O que todo caminho de entrada devolve (cadastro, entrar, senha nova, confirmação
 * do e-mail): a conta e a sessão. O presenter vira `{ accessToken, expiresAt, subscriber }`.
 */
export interface SessaoAberta {
  subscriber: Subscriber;
  sessao: IssuedToken;
}
