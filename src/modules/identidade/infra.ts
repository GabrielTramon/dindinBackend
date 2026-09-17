import type { Router } from 'express';
import type {
  AuthTokenService,
  Clock,
  IdGenerator,
  Mailer,
  SecureTokenGenerator,
} from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import { DescadastrarPorTokenUseCase } from './application/descadastrar-por-token.use-case';
import { DescadastrarUseCase } from './application/descadastrar.use-case';
import { ObterMeUseCase } from './application/obter-me.use-case';
import { ReativarUseCase } from './application/reativar.use-case';
import { SolicitarLinkMagicoUseCase, type LinkMagicoConfig } from './application/solicitar-link-magico.use-case';
import { VerificarLinkMagicoUseCase } from './application/verificar-link-magico.use-case';
import type { SubscribersRepository } from './domain/subscribers-repository';
import { createIdentidadeRouter } from './infra/http/identidade.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.
*/

export { INTERVALO_MINIMO_ENTRE_LINKS_SEGUNDOS } from './application/solicitar-link-magico.use-case';
export type { LinkMagicoConfig } from './application/solicitar-link-magico.use-case';
export { InMemorySubscribersRepository } from './infra/database/in-memory-subscribers-repository';
export { PrismaSubscribersRepository } from './infra/database/prisma-subscribers-repository';

export interface IdentidadeModuleDeps {
  subscribers: SubscribersRepository;
  secureTokens: SecureTokenGenerator;
  authTokens: AuthTokenService;
  mailer: Mailer;
  clock: Clock;
  ids: IdGenerator;
  auth: AuthMiddlewares;
  config: LinkMagicoConfig;
  /** false nos testes que não estão testando o limite por IP */
  rateLimit: { enabled: boolean };
}

export interface IdentidadeModule {
  router: Router;
}

export function createIdentidadeModule(deps: IdentidadeModuleDeps): IdentidadeModule {
  return {
    router: createIdentidadeRouter({
      solicitarLink: new SolicitarLinkMagicoUseCase(
        deps.subscribers,
        deps.secureTokens,
        deps.mailer,
        deps.clock,
        deps.ids,
        deps.config,
      ),
      verificarLink: new VerificarLinkMagicoUseCase(deps.subscribers, deps.secureTokens, deps.authTokens, deps.clock),
      obterMe: new ObterMeUseCase(deps.subscribers),
      descadastrar: new DescadastrarUseCase(deps.subscribers, deps.clock),
      reativar: new ReativarUseCase(deps.subscribers, deps.clock),
      descadastrarPorToken: new DescadastrarPorTokenUseCase(deps.subscribers, deps.authTokens, deps.clock),
      auth: deps.auth,
      rateLimit: deps.rateLimit,
    }),
  };
}
