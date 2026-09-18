import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { parseBody } from '../../../../shared/infra/http/validation';
import type { ObterOrganizacaoUseCase } from '../../application/obter-organizacao.use-case';
import type { SalvarOrganizacaoUseCase } from '../../application/salvar-organizacao.use-case';
import { presentOrganizacao } from './grupo.presenter';
import { salvarOrganizacaoBody } from './organizacao.schemas';

/*
  GET /organizacao   a árvore de grupos da pessoa            200 (vazia: { grupos: [] })
  PUT /organizacao   substitui a árvore inteira              200

  As duas exigem sessão: organização é dado financeiro de uma pessoa. Não há
  POST nem DELETE por grupo — a árvore vive no localStorage e viaja inteira, e
  meia dúzia de endpoints por grupo só criaria estados intermediários que o
  cliente não tem como produzir.

  O controller só traduz: HTTP → entrada do caso de uso → presenter.
*/

export interface OrganizacaoRouterDeps {
  obter: ObterOrganizacaoUseCase;
  salvar: SalvarOrganizacaoUseCase;
  auth: AuthMiddlewares;
}

export function createOrganizacaoRouter(deps: OrganizacaoRouterDeps): Router {
  const router = Router();

  router.get('/organizacao', deps.auth.requireAuth, async (req, res) => {
    const grupos = await deps.obter.execute({ subscriberId: authOf(req).subscriberId });
    // dado financeiro de uma pessoa: nenhum cache guarda
    res.set('Cache-Control', 'private, no-store');
    res.json(presentOrganizacao(grupos));
  });

  router.put('/organizacao', deps.auth.requireAuth, async (req, res) => {
    const corpo = parseBody(req, salvarOrganizacaoBody);
    const grupos = await deps.salvar.execute({
      subscriberId: authOf(req).subscriberId,
      // campo a campo: `{ ...grupo }` deixaria uma chave extra do cliente (subscriberId,
      // ordem, criadoEm) atravessar até a entidade
      grupos: corpo.grupos.map((grupo) => ({
        id: grupo.id,
        nome: grupo.nome,
        icone: grupo.icone,
        valor: grupo.valor,
        contaParaMeta: grupo.contaParaMeta,
        // null do formulário vazio vira ausência: no domínio, opcional é sempre undefined
        rendimentoMensal: grupo.rendimentoMensal ?? undefined,
        doSistema: grupo.doSistema,
        itens: grupo.itens?.map((item) => ({ id: item.id, nome: item.nome, valor: item.valor })),
      })),
    });
    res.set('Cache-Control', 'private, no-store');
    res.json(presentOrganizacao(grupos));
  });

  return router;
}
