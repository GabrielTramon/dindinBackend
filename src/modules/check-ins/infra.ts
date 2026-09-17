import type { Router } from 'express';
import type { AuthTokenService, Clock, IdGenerator, Mailer } from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import type { SubscribersRepository } from '../identidade';
import type { VersoesPlanoRepository } from '../planos';
import { AbrirCheckInsDoMesUseCase, type CheckInMensalConfig } from './application/abrir-check-ins-do-mes.use-case';
import { ListarCheckInsUseCase } from './application/listar-check-ins.use-case';
import { ObterCheckInUseCase } from './application/obter-check-in.use-case';
import { ResponderCheckInUseCase } from './application/responder-check-in.use-case';
import type { CheckInsRepository } from './domain/check-ins-repository';
import { createCheckInsRouter } from './infra/http/check-ins.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.

  Duas portas de entrada: o router (a pessoa responde) e o job do dia 1
  (createAbrirCheckInsDoMes), que o main roda fora do HTTP.
*/

export { AbrirCheckInsDoMesUseCase, TAMANHO_DA_PAGINA_PADRAO } from './application/abrir-check-ins-do-mes.use-case';
export type {
  AbrirCheckInsDoMesInput,
  CheckInMensalConfig,
  RelatorioAberturaCheckIns,
} from './application/abrir-check-ins-do-mes.use-case';
export { InMemoryCheckInsRepository } from './infra/database/in-memory-check-ins-repository';
export type { InMemoryCheckInsOptions } from './infra/database/in-memory-check-ins-repository';
export { PrismaCheckInsRepository } from './infra/database/prisma-check-ins-repository';

export interface CheckInsModuleDeps {
  checkIns: CheckInsRepository;
  versoesPlano: VersoesPlanoRepository;
  auth: AuthMiddlewares;
  ids: IdGenerator;
  clock: Clock;
}

export interface CheckInsModule {
  router: Router;
}

export function createCheckInsModule(deps: CheckInsModuleDeps): CheckInsModule {
  return {
    router: createCheckInsRouter({
      listar: new ListarCheckInsUseCase(deps.checkIns),
      obter: new ObterCheckInUseCase(deps.checkIns, deps.versoesPlano),
      responder: new ResponderCheckInUseCase(deps.checkIns, deps.versoesPlano, deps.ids, deps.clock),
      auth: deps.auth,
    }),
  };
}

export interface AbrirCheckInsDoMesDeps {
  checkIns: CheckInsRepository;
  subscribers: SubscribersRepository;
  mailer: Mailer;
  authTokens: AuthTokenService;
  ids: IdGenerator;
  clock: Clock;
  config: CheckInMensalConfig;
}

/** O job do dia 1, montado. O main chama `execute()` e registra o relatório. */
export function createAbrirCheckInsDoMes(deps: AbrirCheckInsDoMesDeps): AbrirCheckInsDoMesUseCase {
  return new AbrirCheckInsDoMesUseCase(
    deps.checkIns,
    deps.subscribers,
    deps.mailer,
    deps.authTokens,
    deps.ids,
    deps.clock,
    deps.config,
  );
}
