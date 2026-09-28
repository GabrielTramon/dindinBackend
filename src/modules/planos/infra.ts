import type { Router } from 'express';
import type { Clock, IdGenerator } from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import { GerarPlanoUseCase } from './application/gerar-plano.use-case';
import { ListarVersoesPlanoUseCase } from './application/listar-versoes-plano.use-case';
import { ObterPlanoAtualUseCase } from './application/obter-plano-atual.use-case';
import { ObterVersaoPlanoUseCase } from './application/obter-versao-plano.use-case';
import type { PerfilDoMotorReader } from './application/ports';
import { SimularPlanoUseCase } from './application/simular-plano.use-case';
import type { VersoesPlanoRepository } from './domain/versoes-plano-repository';
import { createPlanosRouter } from './infra/http/planos.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.
*/

export { InMemoryVersoesPlanoRepository } from './infra/database/in-memory-versoes-plano-repository';
export { PrismaVersoesPlanoRepository } from './infra/database/prisma-versoes-plano-repository';

export interface PlanosModuleDeps {
  versoesPlano: VersoesPlanoRepository;
  /** o main liga ao CarregarPerfilDoMotorUseCase do módulo perfil */
  perfilReader: PerfilDoMotorReader;
  ids: IdGenerator;
  clock: Clock;
  auth: AuthMiddlewares;
}

export interface PlanosModule {
  router: Router;
}

export function createPlanosModule(deps: PlanosModuleDeps): PlanosModule {
  return {
    router: createPlanosRouter({
      gerar: new GerarPlanoUseCase(deps.versoesPlano, deps.perfilReader, deps.ids, deps.clock),
      simular: new SimularPlanoUseCase(),
      listar: new ListarVersoesPlanoUseCase(deps.versoesPlano),
      obterAtual: new ObterPlanoAtualUseCase(deps.versoesPlano),
      obterVersao: new ObterVersaoPlanoUseCase(deps.versoesPlano),
      auth: deps.auth,
    }),
  };
}
