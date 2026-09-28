import type { Router } from 'express';
import type {
  AuthTokenService,
  BackgroundJobs,
  Clock,
  IdGenerator,
  Mailer,
  PasswordHasher,
  SecureTokenGenerator,
} from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import { CadastrarComSenhaUseCase } from './application/cadastrar-com-senha.use-case';
import { DescadastrarPorTokenUseCase } from './application/descadastrar-por-token.use-case';
import { DescadastrarUseCase } from './application/descadastrar.use-case';
import { EntrarComSenhaUseCase } from './application/entrar-com-senha.use-case';
import { EmissorDeLinks, type LinksConfig } from './application/links-por-email';
import { ObterMeUseCase } from './application/obter-me.use-case';
import { ReativarUseCase } from './application/reativar.use-case';
import { RedefinirSenhaUseCase } from './application/redefinir-senha.use-case';
import { SolicitarRedefinicaoDeSenhaUseCase } from './application/solicitar-redefinicao-de-senha.use-case';
import { TrocarSenhaUseCase } from './application/trocar-senha.use-case';
import { VerificarLinkMagicoUseCase } from './application/verificar-link-magico.use-case';
import type { SubscribersRepository } from './domain/subscribers-repository';
import { createIdentidadeRouter, type AvisosDeIdentidade } from './infra/http/identidade.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.
*/

export { INTERVALO_MINIMO_ENTRE_LINKS_SEGUNDOS } from './application/links-por-email';
export type { LinksConfig } from './application/links-por-email';
export { InMemorySubscribersRepository } from './infra/database/in-memory-subscribers-repository';
export { PrismaSubscribersRepository } from './infra/database/prisma-subscribers-repository';

export interface IdentidadeModuleDeps {
  subscribers: SubscribersRepository;
  secureTokens: SecureTokenGenerator;
  authTokens: AuthTokenService;
  passwords: PasswordHasher;
  mailer: Mailer;
  /** o envio do Esqueci a senha roda aqui, depois da resposta */
  backgroundJobs: BackgroundJobs;
  clock: Clock;
  ids: IdGenerator;
  auth: AuthMiddlewares;
  config: LinksConfig;
  /** false nos testes que não estão testando o limite por IP */
  rateLimit: { enabled: boolean };
  /** onde avisar que o e-mail de confirmação não saiu; padrão: console */
  avisos?: AvisosDeIdentidade;
}

export interface IdentidadeModule {
  router: Router;
}

export function createIdentidadeModule(deps: IdentidadeModuleDeps): IdentidadeModule {
  const links = new EmissorDeLinks(deps.secureTokens, deps.config);
  return {
    router: createIdentidadeRouter({
      cadastrar: new CadastrarComSenhaUseCase(
        deps.subscribers,
        deps.passwords,
        links,
        deps.authTokens,
        deps.mailer,
        deps.clock,
        deps.ids,
      ),
      entrar: new EntrarComSenhaUseCase(deps.subscribers, deps.passwords, deps.authTokens),
      solicitarRedefinicao: new SolicitarRedefinicaoDeSenhaUseCase(
        deps.subscribers,
        links,
        deps.mailer,
        deps.clock,
        deps.backgroundJobs,
      ),
      redefinirSenha: new RedefinirSenhaUseCase(
        deps.subscribers,
        deps.secureTokens,
        deps.passwords,
        deps.authTokens,
        deps.clock,
      ),
      verificarLink: new VerificarLinkMagicoUseCase(deps.subscribers, deps.secureTokens, deps.authTokens, deps.clock),
      trocarSenha: new TrocarSenhaUseCase(deps.subscribers, deps.passwords, deps.authTokens, deps.clock),
      obterMe: new ObterMeUseCase(deps.subscribers),
      descadastrar: new DescadastrarUseCase(deps.subscribers, deps.clock),
      reativar: new ReativarUseCase(deps.subscribers, deps.clock),
      descadastrarPorToken: new DescadastrarPorTokenUseCase(deps.subscribers, deps.authTokens, deps.clock),
      auth: deps.auth,
      rateLimit: deps.rateLimit,
      avisos: deps.avisos ?? { warn: (mensagem, contexto) => console.warn(mensagem, contexto) },
    }),
  };
}
