import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { parseBody } from '../../../../shared/infra/http/validation';
import type { AtualizarPerfilUseCase } from '../../application/atualizar-perfil.use-case';
import type { ObterPerfilCompletoUseCase } from '../../application/obter-perfil-completo.use-case';
import type { ObterPerfilUseCase } from '../../application/obter-perfil.use-case';
import type { SalvarPerfilUseCase } from '../../application/salvar-perfil.use-case';
import type { SincronizarPerfilCompletoUseCase } from '../../application/sincronizar-perfil-completo.use-case';
import { presentPerfil, presentPerfilCompleto } from './perfil.presenter';
import { atualizarPerfilBody, perfilCompletoBody, salvarPerfilBody } from './perfil.schemas';

/*
  GET   /perfil            respostas escalares                               200 | 404
  PUT   /perfil            todas as respostas escalares           201 criou | 200 atualizou
  PATCH /perfil            só as respostas informadas                        200 | 404
  GET   /perfil/completo   perfil + gastos + dívidas, no formato do motor    200 | 404
  PUT   /perfil/completo   substitui tudo e devolve o que ficou gravado      200

  Todas exigem sessão: perfil é dado financeiro de uma pessoa. O controller só
  traduz: HTTP → entrada do caso de uso → presenter.
*/

export interface PerfilRouterDeps {
  obter: ObterPerfilUseCase;
  salvar: SalvarPerfilUseCase;
  atualizar: AtualizarPerfilUseCase;
  obterCompleto: ObterPerfilCompletoUseCase;
  sincronizar: SincronizarPerfilCompletoUseCase;
  auth: AuthMiddlewares;
}

export function createPerfilRouter(deps: PerfilRouterDeps): Router {
  const router = Router();

  router.get('/perfil', deps.auth.requireAuth, async (req, res) => {
    const perfil = await deps.obter.execute({ subscriberId: authOf(req).subscriberId });
    // dado financeiro de uma pessoa: nenhum cache guarda
    res.set('Cache-Control', 'private, no-store');
    res.json(presentPerfil(perfil));
  });

  router.put('/perfil', deps.auth.requireAuth, async (req, res) => {
    const body = parseBody(req, salvarPerfilBody);
    const { perfil, criado } = await deps.salvar.execute({
      subscriberId: authOf(req).subscriberId,
      rendaMensal: body.rendaMensal,
      tipoRenda: body.tipoRenda,
      idade: body.idade,
      moradia: body.moradia,
      custoMoradia: body.custoMoradia,
      guardado: body.guardado,
    });
    if (criado) res.status(201).location('/api/v1/perfil');
    res.json(presentPerfil(perfil));
  });

  router.patch('/perfil', deps.auth.requireAuth, async (req, res) => {
    const body = parseBody(req, atualizarPerfilBody);
    const perfil = await deps.atualizar.execute({
      subscriberId: authOf(req).subscriberId,
      rendaMensal: body.rendaMensal,
      tipoRenda: body.tipoRenda,
      idade: body.idade,
      moradia: body.moradia,
      custoMoradia: body.custoMoradia,
      guardado: body.guardado,
    });
    res.json(presentPerfil(perfil));
  });

  router.get('/perfil/completo', deps.auth.requireAuth, async (req, res) => {
    const perfil = await deps.obterCompleto.execute({ subscriberId: authOf(req).subscriberId });
    res.set('Cache-Control', 'private, no-store');
    res.json(presentPerfilCompleto(perfil));
  });

  router.put('/perfil/completo', deps.auth.requireAuth, async (req, res) => {
    const perfil = parseBody(req, perfilCompletoBody);
    const gravado = await deps.sincronizar.execute({ subscriberId: authOf(req).subscriberId, perfil });
    res.json(presentPerfilCompleto(gravado));
  });

  return router;
}
