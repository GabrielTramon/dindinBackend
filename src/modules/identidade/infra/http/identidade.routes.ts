import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { createRateLimiter } from '../../../../shared/infra/http/rate-limit';
import { parseBody } from '../../../../shared/infra/http/validation';
import type { CadastrarComSenhaUseCase } from '../../application/cadastrar-com-senha.use-case';
import type { DescadastrarPorTokenUseCase } from '../../application/descadastrar-por-token.use-case';
import type { DescadastrarUseCase } from '../../application/descadastrar.use-case';
import type { EntrarComSenhaUseCase } from '../../application/entrar-com-senha.use-case';
import type { ObterMeUseCase } from '../../application/obter-me.use-case';
import type { ReativarUseCase } from '../../application/reativar.use-case';
import type { RedefinirSenhaUseCase } from '../../application/redefinir-senha.use-case';
import type { SolicitarRedefinicaoDeSenhaUseCase } from '../../application/solicitar-redefinicao-de-senha.use-case';
import type { TrocarSenhaUseCase } from '../../application/trocar-senha.use-case';
import type { VerificarLinkMagicoUseCase } from '../../application/verificar-link-magico.use-case';
import {
  cadastrarBody,
  descadastrarPorTokenBody,
  entrarBody,
  esqueciSenhaBody,
  redefinirSenhaBody,
  trocarSenhaBody,
  verificarLinkBody,
} from './identidade.schemas';
import { presentSessao, presentSubscriber } from './subscriber.presenter';

/*
  POST /auth/cadastrar        cria a conta com e-mail e senha e já entra (público)     201
  POST /auth/entrar           e-mail e senha → sessão (público)                        200
  POST /auth/esqueci-senha    manda o link "Criar uma senha nova" (público)            202
  POST /auth/redefinir-senha  link do e-mail + senha nova → sessão (público)           200
  POST /auth/verificar        link "Confirme seu e-mail" → sessão (público)            200
  GET  /me                    a conta autenticada, com temSenha                        200
  POST /me/senha              troca (ou cria, na conta antiga) a senha → sessão nova   200
  POST /me/descadastrar       para o e-mail mensal                                     200
  POST /me/reativar           volta a receber o e-mail mensal                          200
  POST /descadastrar          descadastro pelo link do e-mail (público)                204

  POST /auth/link-magico (entrar sem senha) saiu: responde 404.

  Toda rota pública tem limite por IP, um contador por rota; o Esqueci a senha
  ainda tem o limite por endereço, no caso de uso. As respostas com sessão vão
  com `Cache-Control: no-store`.

  O 202 do Esqueci a senha sai sem esperar a conta nem o e-mail (o caso de uso
  agenda o envio pra depois da resposta): tempo e status iguais pra quem tem
  conta e pra quem não tem.

  POST /me/senha devolve uma sessão nova: a senha nova encerra todas as de
  antes, inclusive a que fez o pedido (ver TrocarSenhaUseCase).
*/

const QUINZE_MINUTOS = 15 * 60 * 1000;

export const LIMITES_POR_IP = {
  cadastrar: { windowMs: QUINZE_MINUTOS, limit: 10 },
  entrar: { windowMs: QUINZE_MINUTOS, limit: 10 },
  esqueciSenha: { windowMs: QUINZE_MINUTOS, limit: 5 },
  redefinirSenha: { windowMs: QUINZE_MINUTOS, limit: 20 },
  verificar: { windowMs: QUINZE_MINUTOS, limit: 20 },
  // com a sessão, mas confere a senha atual: sem teto, uma sessão roubada testaria senhas à vontade
  trocarSenha: { windowMs: QUINZE_MINUTOS, limit: 10 },
  descadastrar: { windowMs: QUINZE_MINUTOS, limit: 20 },
} as const;

/** A mesma frase pra e-mail com e sem conta e dentro do limite de reenvio: não revela quem tem conta. */
export const MENSAGEM_ESQUECI_SENHA =
  'Se existir uma conta com esse e-mail, o link pra criar uma senha nova chega em instantes.';

/** Onde avisar que o e-mail de confirmação não saiu (a conta foi criada do mesmo jeito). */
export interface AvisosDeIdentidade {
  warn(mensagem: string, contexto: Record<string, unknown>): void;
}

export interface IdentidadeRouterDeps {
  cadastrar: CadastrarComSenhaUseCase;
  entrar: EntrarComSenhaUseCase;
  solicitarRedefinicao: SolicitarRedefinicaoDeSenhaUseCase;
  redefinirSenha: RedefinirSenhaUseCase;
  verificarLink: VerificarLinkMagicoUseCase;
  trocarSenha: TrocarSenhaUseCase;
  obterMe: ObterMeUseCase;
  descadastrar: DescadastrarUseCase;
  reativar: ReativarUseCase;
  descadastrarPorToken: DescadastrarPorTokenUseCase;
  auth: AuthMiddlewares;
  rateLimit: { enabled: boolean };
  avisos: AvisosDeIdentidade;
}

export function createIdentidadeRouter(deps: IdentidadeRouterDeps): Router {
  const router = Router();
  const { enabled } = deps.rateLimit;
  // um limitador (e um contador) por rota: errar a senha 10 vezes não bloqueia o Esqueci a senha
  const limite = (nome: keyof typeof LIMITES_POR_IP) => createRateLimiter({ ...LIMITES_POR_IP[nome], enabled });
  const limiteCadastrar = limite('cadastrar');
  const limiteEntrar = limite('entrar');
  const limiteEsqueciSenha = limite('esqueciSenha');
  const limiteRedefinirSenha = limite('redefinirSenha');
  const limiteVerificar = limite('verificar');
  const limiteTrocarSenha = limite('trocarSenha');
  const limiteDescadastrar = limite('descadastrar');

  router.post('/auth/cadastrar', limiteCadastrar, async (req, res) => {
    const { email, senha } = parseBody(req, cadastrarBody);
    const resultado = await deps.cadastrar.execute({ email, senha });
    if (resultado.falhaNoEnvio) {
      const { erro } = resultado.falhaNoEnvio;
      deps.avisos.warn('Conta criada, mas o e-mail de confirmação não saiu', {
        requestId: req.requestId,
        erro: erro instanceof Error ? { name: erro.name, message: erro.message } : String(erro),
      });
    }
    // a resposta carrega a sessão: nenhum cache guarda
    res.set('Cache-Control', 'no-store');
    res.status(201).location('/api/v1/me').json(presentSessao(resultado));
  });

  router.post('/auth/entrar', limiteEntrar, async (req, res) => {
    const { email, senha } = parseBody(req, entrarBody);
    const resultado = await deps.entrar.execute({ email, senha });
    res.set('Cache-Control', 'no-store');
    res.json(presentSessao(resultado));
  });

  router.post('/auth/esqueci-senha', limiteEsqueciSenha, async (req, res) => {
    const { email } = parseBody(req, esqueciSenhaBody);
    await deps.solicitarRedefinicao.execute({ email });
    res.status(202).json({ message: MENSAGEM_ESQUECI_SENHA });
  });

  router.post('/auth/redefinir-senha', limiteRedefinirSenha, async (req, res) => {
    const { token, senha } = parseBody(req, redefinirSenhaBody);
    const resultado = await deps.redefinirSenha.execute({ token, senha });
    res.set('Cache-Control', 'no-store');
    res.json(presentSessao(resultado));
  });

  router.post('/auth/verificar', limiteVerificar, async (req, res) => {
    const { token } = parseBody(req, verificarLinkBody);
    const resultado = await deps.verificarLink.execute({ token });
    res.set('Cache-Control', 'no-store');
    res.json(presentSessao(resultado));
  });

  router.get('/me', deps.auth.requireAuth, async (req, res) => {
    const subscriber = await deps.obterMe.execute({ subscriberId: authOf(req).subscriberId });
    res.set('Cache-Control', 'private, no-store');
    res.json(presentSubscriber(subscriber));
  });

  // o limite vem depois do requireAuth: pedido sem sessão é 401 e não gasta o contador
  router.post('/me/senha', deps.auth.requireAuth, limiteTrocarSenha, async (req, res) => {
    const { senhaAtual, senhaNova } = parseBody(req, trocarSenhaBody);
    const resultado = await deps.trocarSenha.execute({ subscriberId: authOf(req).subscriberId, senhaAtual, senhaNova });
    res.set('Cache-Control', 'no-store');
    res.json(presentSessao(resultado));
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
