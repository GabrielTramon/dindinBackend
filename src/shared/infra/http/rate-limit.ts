import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { errorBody } from './error-handler';

/*
  Limite de requisições por IP. Usado nas rotas que disparam e-mail ou
  validam token — sem ele, dá pra usar o link mágico pra bombardear a caixa
  de alguém.

  O contador fica na memória do processo: com mais de uma instância da API,
  troque o `store` por um compartilhado (Redis) antes de escalar horizontalmente.
*/

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
  /** false nos testes que não estão testando o limite */
  enabled?: boolean;
}

export function createRateLimiter({ windowMs, limit, enabled = true }: RateLimitOptions): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      res
        .status(429)
        .json(
          errorBody('MUITAS_REQUISICOES', 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.', req.requestId),
        );
    },
  });
}
