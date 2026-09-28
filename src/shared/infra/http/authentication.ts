import type { Request, RequestHandler } from 'express';
import type { AuthTokenService, SessionAccounts } from '../../application/ports';
import { UnauthorizedError } from '../../domain/errors';

/*
  Autenticação por token de sessão no header `Authorization: Bearer <token>`.

  - requireAuth: sem token válido → 401.
  - optionalAuth: sem header → segue anônimo; header com token inválido → 401.
    Token vencido não vira "anônimo" em silêncio: o cliente precisa saber que
    a sessão acabou, senão mostra dados de visitante achando que está logado.

  Além da assinatura, os dois perguntam ao SessionAccounts pela conta (uma busca
  por chave primária): conta excluída = sessão encerrada; versão do token
  diferente da versaoSessao da conta = a senha mudou depois que o token saiu,
  sessão encerrada também.

  optionalAuth manda `Vary: Authorization`: a mesma URL responde diferente com e
  sem token, e sem o Vary o cache do navegador entrega a resposta pública pra
  quem acabou de entrar.
*/

const SESSION_EXPIRED = 'Sua sessão expirou. Entre de novo com seu e-mail e senha.';

function bearerToken(req: Request): string | undefined {
  const header = req.get('authorization');
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : '';
}

export interface AuthMiddlewares {
  requireAuth: RequestHandler;
  optionalAuth: RequestHandler;
}

export function createAuthMiddlewares(tokens: AuthTokenService, accounts: SessionAccounts): AuthMiddlewares {
  async function sessionFrom(token: string): Promise<{ subscriberId: string } | null> {
    const session = token ? tokens.verifySession(token) : null;
    if (!session) return null;
    const versaoAtual = await accounts.sessionVersion(session.subscriberId);
    // só o id segue pra requisição: a versão é assunto daqui
    return versaoAtual !== null && versaoAtual === session.versao ? { subscriberId: session.subscriberId } : null;
  }

  const requireAuth: RequestHandler = async (req, _res, next) => {
    const token = bearerToken(req);
    if (token === undefined) throw new UnauthorizedError('Entre pra continuar.');
    const session = await sessionFrom(token);
    if (!session) throw new UnauthorizedError(SESSION_EXPIRED);
    req.auth = session;
    next();
  };

  const optionalAuth: RequestHandler = async (req, res, next) => {
    res.vary('Authorization');
    const token = bearerToken(req);
    if (token === undefined) return next();
    const session = await sessionFrom(token);
    if (!session) throw new UnauthorizedError(SESSION_EXPIRED);
    req.auth = session;
    next();
  };

  return { requireAuth, optionalAuth };
}

/** O subscriber autenticado. Use depois de requireAuth. */
export function authOf(req: Request): { subscriberId: string } {
  if (!req.auth) throw new UnauthorizedError('Entre pra continuar.');
  return req.auth;
}
