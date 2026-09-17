import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { parseBody, parseParams, parseQuery } from '../../../../shared/infra/http/validation';
import type { GerarPlanoUseCase } from '../../application/gerar-plano.use-case';
import type { ListarVersoesPlanoUseCase } from '../../application/listar-versoes-plano.use-case';
import type { ObterPlanoAtualUseCase } from '../../application/obter-plano-atual.use-case';
import type { ObterVersaoPlanoUseCase } from '../../application/obter-versao-plano.use-case';
import type { SimularPlanoUseCase } from '../../application/simular-plano.use-case';
import { listarVersoesQuery, simularBody, versaoParams } from './planos.schemas';
import { presentItemHistoricoPlano, presentSimulacaoPlano, presentVersaoPlano } from './versao-plano.presenter';

/*
  POST /planos             gera com o perfil salvo: 201 versão nova, 200 nada mudou
  POST /planos/simular     público; roda o motor com o perfil do corpo, não grava   200
  GET  /planos             histórico, da mais nova pra mais antiga (limit, cursor)  200
  GET  /planos/atual       a versão mais nova                                       200
  GET  /planos/:versao     uma versão do histórico                                  200

  /planos/simular e /planos/atual vêm antes de /planos/:versao: o Express casa
  na ordem de declaração, e "atual" cairia no parâmetro (e viraria 400).

  O controller só traduz: HTTP → entrada do caso de uso → presenter. Nenhuma
  regra de negócio mora aqui.
*/

export interface PlanosRouterDeps {
  gerar: GerarPlanoUseCase;
  simular: SimularPlanoUseCase;
  listar: ListarVersoesPlanoUseCase;
  obterAtual: ObterPlanoAtualUseCase;
  obterVersao: ObterVersaoPlanoUseCase;
  auth: AuthMiddlewares;
}

export function createPlanosRouter(deps: PlanosRouterDeps): Router {
  const router = Router();

  // corpo ignorado de propósito: perfil e dono vêm do servidor, nunca do cliente
  router.post('/planos', deps.auth.requireAuth, async (req, res) => {
    const { versao, criada } = await deps.gerar.execute({ subscriberId: authOf(req).subscriberId });
    if (criada) res.status(201).location(`/api/v1/planos/${versao.versao}`);
    res.json(presentVersaoPlano(versao));
  });

  // sem autenticação: é a calculadora pública, e nada é gravado
  router.post('/planos/simular', async (req, res) => {
    const perfil = parseBody(req, simularBody);
    const plano = await deps.simular.execute({ perfil });
    res.json(presentSimulacaoPlano(plano));
  });

  router.get('/planos', deps.auth.requireAuth, async (req, res) => {
    const { limit, cursor } = parseQuery(req, listarVersoesQuery);
    const page = await deps.listar.execute({ subscriberId: authOf(req).subscriberId, limit, cursor });
    res.json({ items: page.items.map(presentItemHistoricoPlano), nextCursor: page.nextCursor });
  });

  router.get('/planos/atual', deps.auth.requireAuth, async (req, res) => {
    const atual = await deps.obterAtual.execute({ subscriberId: authOf(req).subscriberId });
    res.json(presentVersaoPlano(atual));
  });

  router.get('/planos/:versao', deps.auth.requireAuth, async (req, res) => {
    const { versao } = parseParams(req, versaoParams);
    const encontrada = await deps.obterVersao.execute({ subscriberId: authOf(req).subscriberId, versao });
    res.json(presentVersaoPlano(encontrada));
  });

  return router;
}
