import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { parseBody, parseParams, parseQuery } from '../../../../shared/infra/http/validation';
import type { ListarCheckInsUseCase } from '../../application/listar-check-ins.use-case';
import type { ObterCheckInUseCase } from '../../application/obter-check-in.use-case';
import type { ResponderCheckInUseCase } from '../../application/responder-check-in.use-case';
import { presentCheckIn, presentCheckInComComparacao } from './check-in.presenter';
import { competenciaParams, listarCheckInsQuery, responderCheckInBody } from './check-ins.schemas';

/*
  GET /check-ins                 os meses da pessoa, do mais recente (limit, cursor)   200
  GET /check-ins/:competencia    um mês, com a comparação com o plano atual            200
  PUT /check-ins/:competencia    responde como foi o mês (abre se o job ainda não
                                 abriu) ou corrige a resposta                          200

  PUT e não POST: o endereço é o mês, e responder de novo o mesmo mês substitui a
  resposta — idempotente. Sempre 200, mesmo quando abre: pra quem responde, o
  check-in do mês "já existia" desde o dia 1.

  O controller só traduz: HTTP → entrada do caso de uso → presenter. Nenhuma
  regra de negócio mora aqui.
*/

export interface CheckInsRouterDeps {
  listar: ListarCheckInsUseCase;
  obter: ObterCheckInUseCase;
  responder: ResponderCheckInUseCase;
  auth: AuthMiddlewares;
}

export function createCheckInsRouter(deps: CheckInsRouterDeps): Router {
  const router = Router();

  router.get('/check-ins', deps.auth.requireAuth, async (req, res) => {
    const { limit, cursor } = parseQuery(req, listarCheckInsQuery);
    const page = await deps.listar.execute({ subscriberId: authOf(req).subscriberId, limit, cursor });
    res.json({ items: page.items.map(presentCheckIn), nextCursor: page.nextCursor });
  });

  router.get('/check-ins/:competencia', deps.auth.requireAuth, async (req, res) => {
    const { competencia } = parseParams(req, competenciaParams);
    const resultado = await deps.obter.execute({ subscriberId: authOf(req).subscriberId, competencia });
    res.json(presentCheckInComComparacao(resultado));
  });

  // dono vem da sessão; do corpo só os três valores (chave extra é descartada pelo schema)
  router.put('/check-ins/:competencia', deps.auth.requireAuth, async (req, res) => {
    const { competencia } = parseParams(req, competenciaParams);
    const { rendaReal, gastoReal, guardadoReal } = parseBody(req, responderCheckInBody);
    const resultado = await deps.responder.execute({
      subscriberId: authOf(req).subscriberId,
      competencia,
      rendaReal,
      gastoReal,
      guardadoReal,
    });
    res.json(presentCheckInComComparacao(resultado));
  });

  return router;
}
