import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const ACCEPTED = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Dá um id a cada requisição. Reaproveita o X-Request-Id de um proxy/gateway
 * quando ele vem num formato seguro; senão gera um. O id volta no header da
 * resposta e em todo corpo de erro — é o que liga a reclamação do usuário à
 * linha do log.
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.requestId = incoming && ACCEPTED.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  };
}
