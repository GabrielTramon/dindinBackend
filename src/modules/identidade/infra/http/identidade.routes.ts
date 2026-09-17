import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { createRateLimiter } from '../../../../shared/infra/http/rate-limit';
import { parseBody } from '../../../../shared/infra/http/validation';
import type { DescadastrarPorTokenUseCase } from '../../application/descadastrar-por-token.use-case';
import type { DescadastrarUseCase } from '../../application/descadastrar.use-case';
import type { ObterMeUseCase } from '../../application/obter-me.use-case';
import type { ReativarUseCase } from '../../application/reativar.use-case';
import type { SolicitarLinkMagicoUseCase } from '../../application/solicitar-link-magico.use-case';
import type { VerificarLinkMagicoUseCase } from '../../application/verificar-link-magico.use-case';
import { descadastrarPorTokenBody, solicitarLinkBody, verificarLinkBody } from './identidade.schemas';
import { presentSessao, presentSubscriber } from './subscriber.presenter';

/*
  POST /auth/link-magico     pede o link por e-mail (público)             202
  POST /auth/verificar       troca o link por uma sessão (público)        200
  GET  /me                   a conta autenticada                          200
  POST /me/descadastrar      para o e-mail mensal                         200
  POST /me/reativar          volta a receber o e-mail mensal              200
  POST /descadastrar         descadastro pelo link do e-mail (público)    204

  As rotas públicas que disparam e-mail ou conferem token têm limite por IP;
  o pedido de link ainda tem o limite por endereço, no caso de uso.
*/

const QUINZE_MINUTOS = 15 * 60 * 1000;

export const LIMITES_POR_IP = {
  linkMagico: { windowMs: QUINZE_MINUTOS, limit: 5 },
  verificar: { windowMs: QUINZE_MINUTOS, limit: 20 },
  descadastrar: { windowMs: QUINZE_MINUTOS, limit: 20 },
} as const;

/** A mesma frase pra e-mail novo, existente e dentro do limite de reenvio: não revela quem tem conta. */
export const MENSAGEM_LINK_SOLICITADO = 'Se esse e-mail puder entrar, o link chega em instantes.';

export interface IdentidadeRouterDeps {
  solicitarLink: SolicitarLinkMagicoUseCase;
  verificarLink: VerificarLinkMagicoUseCase;
  obterMe: ObterMeUseCase;
  descadastrar: DescadastrarUseCase;
  reativar: ReativarUseCase;
  descadastrarPorToken: DescadastrarPorTokenUseCase;
  auth: AuthMiddlewares;
  rateLimit: { enabled: boolean };
}

export function createIdentidadeRouter(deps: IdentidadeRouterDeps): Router {
  const router = Router();
  const { enabled } = deps.rateLimit;
  // um limitador (e um contador) por rota: errar o token 20 vezes não bloqueia o pedido de link
  const limiteLinkMagico = createRateLimiter({ ...LIMITES_POR_IP.linkMagico, enabled });
  const limiteVerificar = createRateLimiter({ ...LIMITES_POR_IP.verificar, enabled });
  const limiteDescadastrar = createRateLimiter({ ...LIMITES_POR_IP.descadastrar, enabled });

  router.post('/auth/link-magico', limiteLinkMagico, async (req, res) => {
    const { email } = parseBody(req, solicitarLinkBody);
    await deps.solicitarLink.execute({ email });
    res.status(202).json({ message: MENSAGEM_LINK_SOLICITADO });
  });

  router.post('/auth/verificar', limiteVerificar, async (req, res) => {
    const { token } = parseBody(req, verificarLinkBody);
    const resultado = await deps.verificarLink.execute({ token });
    // a resposta carrega a sessão: nenhum cache guarda
    res.set('Cache-Control', 'no-store');
    res.json(presentSessao(resultado));
  });

  router.get('/me', deps.auth.requireAuth, async (req, res) => {
    const subscriber = await deps.obterMe.execute({ subscriberId: authOf(req).subscriberId });
    res.set('Cache-Control', 'private, no-store');
    res.json(presentSubscriber(subscriber));
  });

  router.post('/me/descadastrar', deps.auth.requireAuth, async (req, res) => {
    const subscriber = await deps.descadastrar.execute({ subscriberId: authOf(req).subscriberId });
    res.json(presentSubscriber(subscriber));
  });

  router.post('/me/reativar', deps.auth.requireAuth, async (req, res) => {
    const subscriber = await deps.reativar.execute({ subscriberId: authOf(req).subscriberId });
    res.json(presentSubscriber(subscriber));
  });

  router.post('/descadastrar', limiteDescadastrar, async (req, res) => {
    const { token } = parseBody(req, descadastrarPorTokenBody);
    await deps.descadastrarPorToken.execute({ token });
    res.status(204).end();
  });

  return router;
}
