import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { parseBody, parseParams } from '../../../../shared/infra/http/validation';
import type { AdicionarDividaUseCase } from '../../application/adicionar-divida.use-case';
import type { AlterarDividaUseCase } from '../../application/alterar-divida.use-case';
import type { ListarDividasUseCase } from '../../application/listar-dividas.use-case';
import type { RemoverDividaUseCase } from '../../application/remover-divida.use-case';
import { presentDivida, presentDividas } from './divida.presenter';
import { adicionarDividaBody, alterarDividaBody, dividaParams } from './dividas.schemas';

/*
  GET    /perfil/dividas        lista as dívidas do perfil          200
  POST   /perfil/dividas        adiciona                            201
  PATCH  /perfil/dividas/:id    altera campos (null limpa)          200
  DELETE /perfil/dividas/:id    remove                              204

  Todas privadas. O controller só traduz: HTTP → entrada do caso de uso →
  presenter. Nenhuma regra de negócio mora aqui.
*/

export interface DividasRouterDeps {
  listar: ListarDividasUseCase;
  adicionar: AdicionarDividaUseCase;
  alterar: AlterarDividaUseCase;
  remover: RemoverDividaUseCase;
  auth: AuthMiddlewares;
}

export function createDividasRouter(deps: DividasRouterDeps): Router {
  const router = Router();

  router.get('/perfil/dividas', deps.auth.requireAuth, async (req, res) => {
    const dividas = await deps.listar.execute({ subscriberId: authOf(req).subscriberId });
    // dado financeiro de uma pessoa: nenhum cache guarda
    res.set('Cache-Control', 'private, no-store');
    res.json({ items: presentDividas(dividas) });
  });

  router.post('/perfil/dividas', deps.auth.requireAuth, async (req, res) => {
    const body = parseBody(req, adicionarDividaBody);
    const divida = await deps.adicionar.execute({
      subscriberId: authOf(req).subscriberId,
      tipo: body.tipo,
      saldo: body.saldo,
      parcela: body.parcela,
      taxaAnual: body.taxaAnual,
    });
    res.status(201).location(`/api/v1/perfil/dividas/${divida.id}`).json(presentDivida(divida));
  });

  router.patch('/perfil/dividas/:id', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, dividaParams);
    const body = parseBody(req, alterarDividaBody);
    const divida = await deps.alterar.execute({
      subscriberId: authOf(req).subscriberId,
      dividaId: id,
      tipo: body.tipo,
      saldo: body.saldo,
      parcela: body.parcela,
      taxaAnual: body.taxaAnual,
    });
    res.json(presentDivida(divida));
  });

  router.delete('/perfil/dividas/:id', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, dividaParams);
    await deps.remover.execute({ subscriberId: authOf(req).subscriberId, dividaId: id });
    res.status(204).end();
  });

  return router;
}
