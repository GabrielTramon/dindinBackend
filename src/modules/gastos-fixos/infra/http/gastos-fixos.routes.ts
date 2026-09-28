import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { parseBody, parseParams } from '../../../../shared/infra/http/validation';
import type { AdicionarGastoFixoUseCase } from '../../application/adicionar-gasto-fixo.use-case';
import type { AlterarGastoFixoUseCase } from '../../application/alterar-gasto-fixo.use-case';
import type { ListarGastosFixosUseCase } from '../../application/listar-gastos-fixos.use-case';
import type { RemoverGastoFixoUseCase } from '../../application/remover-gasto-fixo.use-case';
import { presentGastoFixo, presentGastosFixos } from './gasto-fixo.presenter';
import { adicionarGastoFixoBody, alterarGastoFixoBody, gastoFixoParams } from './gastos-fixos.schemas';

/*
  GET    /perfil/gastos-fixos        lista, com o total                   200
  POST   /perfil/gastos-fixos        adiciona numa categoria              201
  PATCH  /perfil/gastos-fixos/:id    altera o valor                       200
  DELETE /perfil/gastos-fixos/:id    remove                               204

  Todas exigem sessão: gasto é dado do perfil da pessoa. O controller só
  traduz: HTTP → entrada do caso de uso → presenter.
*/

export interface GastosFixosRouterDeps {
  listar: ListarGastosFixosUseCase;
  adicionar: AdicionarGastoFixoUseCase;
  alterar: AlterarGastoFixoUseCase;
  remover: RemoverGastoFixoUseCase;
  auth: AuthMiddlewares;
}

export function createGastosFixosRouter(deps: GastosFixosRouterDeps): Router {
  const router = Router();

  router.get('/perfil/gastos-fixos', deps.auth.requireAuth, async (req, res) => {
    const itens = await deps.listar.execute({ subscriberId: authOf(req).subscriberId });
    // dado financeiro de uma pessoa: nenhum cache compartilhado guarda
    res.set('Cache-Control', 'private, no-store');
    res.json(presentGastosFixos(itens));
  });

  router.post('/perfil/gastos-fixos', deps.auth.requireAuth, async (req, res) => {
    const { categoriaId, valor } = parseBody(req, adicionarGastoFixoBody);
    const item = await deps.adicionar.execute({ subscriberId: authOf(req).subscriberId, categoriaId, valor });
    res.status(201).location(`/api/v1/perfil/gastos-fixos/${item.gasto.id}`).json(presentGastoFixo(item));
  });

  router.patch('/perfil/gastos-fixos/:id', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, gastoFixoParams);
    const { valor } = parseBody(req, alterarGastoFixoBody);
    const item = await deps.alterar.execute({ subscriberId: authOf(req).subscriberId, gastoId: id, valor });
    res.json(presentGastoFixo(item));
  });

  router.delete('/perfil/gastos-fixos/:id', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, gastoFixoParams);
    await deps.remover.execute({ subscriberId: authOf(req).subscriberId, gastoId: id });
    res.status(204).end();
  });

  return router;
}
