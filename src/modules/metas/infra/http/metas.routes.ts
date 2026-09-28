import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { parseBody, parseParams } from '../../../../shared/infra/http/validation';
import type { AtualizarMetaUseCase } from '../../application/atualizar-meta.use-case';
import type { CriarMetaUseCase } from '../../application/criar-meta.use-case';
import type { DespublicarMetaUseCase } from '../../application/despublicar-meta.use-case';
import type { ListarMetasUseCase } from '../../application/listar-metas.use-case';
import type { ObterMetaPublicaUseCase } from '../../application/obter-meta-publica.use-case';
import type { ObterMetaUseCase } from '../../application/obter-meta.use-case';
import type { PublicarMetaUseCase } from '../../application/publicar-meta.use-case';
import type { RemoverMetaUseCase } from '../../application/remover-meta.use-case';
import { presentMeta, presentMetaPublica } from './meta.presenter';
import { atualizarMetaBody, criarMetaBody, metaParams, metaPublicaParams } from './metas.schemas';

/*
  GET    /metas                     metas da pessoa, com projeção            200
  POST   /metas                     cria                                     201
  GET    /metas/publicas/:slug      PÚBLICO: nome e progresso                200
  GET    /metas/:id                 uma meta                                 200
  PATCH  /metas/:id                 altera parcialmente                      200
  DELETE /metas/:id                 remove                                   204
  POST   /metas/:id/publicar        dá um endereço público (idempotente)     200
  DELETE /metas/:id/publicar        tira do ar                               200

  O controller só traduz: HTTP → entrada do caso de uso → presenter. Nenhuma
  regra de negócio mora aqui.
*/

export interface MetasRouterDeps {
  listar: ListarMetasUseCase;
  criar: CriarMetaUseCase;
  obter: ObterMetaUseCase;
  atualizar: AtualizarMetaUseCase;
  remover: RemoverMetaUseCase;
  publicar: PublicarMetaUseCase;
  despublicar: DespublicarMetaUseCase;
  obterPublica: ObterMetaPublicaUseCase;
  auth: AuthMiddlewares;
}

export function createMetasRouter(deps: MetasRouterDeps): Router {
  const router = Router();

  router.get('/metas', deps.auth.requireAuth, async (req, res) => {
    const metas = await deps.listar.execute({ subscriberId: authOf(req).subscriberId });
    res.json({ items: metas.map(presentMeta) });
  });

  router.post('/metas', deps.auth.requireAuth, async (req, res) => {
    const corpo = parseBody(req, criarMetaBody);
    const criada = await deps.criar.execute({
      subscriberId: authOf(req).subscriberId,
      nome: corpo.nome,
      valorAlvo: corpo.valorAlvo,
      aporteMensal: corpo.aporteMensal,
      prazoMeses: corpo.prazoMeses,
      acumulado: corpo.acumulado,
    });
    res.status(201).location(`/api/v1/metas/${criada.meta.id}`).json(presentMeta(criada));
  });

  /*
    Sem middleware de autenticação: a resposta é a mesma pra qualquer pessoa, com
    ou sem token — por isso pode ir pra cache compartilhado sem `Vary: Authorization`,
    e um token vencido no navegador de quem abre o link não vira 401 numa página pública.
  */
  router.get('/metas/publicas/:slug', async (req, res) => {
    const { slug } = parseParams(req, metaPublicaParams);
    const meta = await deps.obterPublica.execute({ slug });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(presentMetaPublica(meta));
  });

  router.get('/metas/:id', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, metaParams);
    const meta = await deps.obter.execute({ subscriberId: authOf(req).subscriberId, metaId: id });
    res.json(presentMeta(meta));
  });

  router.patch('/metas/:id', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, metaParams);
    const corpo = parseBody(req, atualizarMetaBody);
    const meta = await deps.atualizar.execute({
      subscriberId: authOf(req).subscriberId,
      metaId: id,
      nome: corpo.nome,
      valorAlvo: corpo.valorAlvo,
      aporteMensal: corpo.aporteMensal,
      prazoMeses: corpo.prazoMeses,
      acumulado: corpo.acumulado,
    });
    res.json(presentMeta(meta));
  });

  router.delete('/metas/:id', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, metaParams);
    await deps.remover.execute({ subscriberId: authOf(req).subscriberId, metaId: id });
    res.status(204).end();
  });

  router.post('/metas/:id/publicar', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, metaParams);
    const meta = await deps.publicar.execute({ subscriberId: authOf(req).subscriberId, metaId: id });
    res.json(presentMeta(meta));
  });

  router.delete('/metas/:id/publicar', deps.auth.requireAuth, async (req, res) => {
    const { id } = parseParams(req, metaParams);
    const meta = await deps.despublicar.execute({ subscriberId: authOf(req).subscriberId, metaId: id });
    res.json(presentMeta(meta));
  });

  return router;
}
