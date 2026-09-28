import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { parseBody, parseParams } from '../../../../shared/infra/http/validation';
import type { CriarCategoriaPersonalizadaUseCase } from '../../application/criar-categoria-personalizada.use-case';
import type { ExcluirCategoriaUseCase } from '../../application/excluir-categoria.use-case';
import type { ListarCategoriasUseCase } from '../../application/listar-categorias.use-case';
import type { RenomearCategoriaUseCase } from '../../application/renomear-categoria.use-case';
import { presentCategoria } from './categoria.presenter';
import { categoriaParams, nomeCategoriaBody } from './categorias.schemas';

/*
  GET    /categorias        público; autenticado inclui as personalizadas
  POST   /categorias        cria personalizada                         201
  PATCH  /categorias/:id    renomeia personalizada                     200
  DELETE /categorias/:id    exclui personalizada sem gastos            204

  O controller só traduz: HTTP → entrada do caso de uso → presenter. Nenhuma
  regra de negócio mora aqui.
*/

export interface CategoriasRouterDeps {
  listar: ListarCategoriasUseCase;
  criar: CriarCategoriaPersonalizadaUseCase;
  renomear: RenomearCategoriaUseCase;
  excluir: ExcluirCategoriaUseCase;
  auth: AuthMiddlewares;
}

export function createCategoriasRouter(deps: CategoriasRouterDeps): Router {
  const router = Router();

  router.get('/categorias', deps.auth.optionalAuth, async (req, res) => {
    const subscriberId = req.auth?.subscriberId ?? null;
    const categorias = await deps.listar.execute({ subscriberId });
    // só o catálogo é igual pra todo mundo e pode ir pra cache compartilhado
    res.set('Cache-Control', subscriberId === null ? 'public, max-age=3600' : 'private, no-store');
    res.json({ items: categorias.map(presentCategoria) });
  });

  router.post('/categorias', deps.auth.requireAuth, async (req, res) => {
    const { nome } = parseBody(req, nomeCategoriaBody);
    const categoria = await deps.criar.execute({ subscriberId: authOf(req).subscriberId, nome });
    res.status(201).location(`/api/v1/categorias/${categoria.id}`).json(presentCategoria(categoria));
  });

  router.patch('/categorias/:id', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, categoriaParams);
    const { nome } = parseBody(req, nomeCategoriaBody);
    const categoria = await deps.renomear.execute({ subscriberId: authOf(req).subscriberId, categoriaId: id, nome });
    res.json(presentCategoria(categoria));
  });

  router.delete('/categorias/:id', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, categoriaParams);
    await deps.excluir.execute({ subscriberId: authOf(req).subscriberId, categoriaId: id });
    res.status(204).end();
  });

  return router;
}
