import type { Router } from 'express';
import type { Clock, IdGenerator } from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import { AdicionarDividaUseCase } from './application/adicionar-divida.use-case';
import { AlterarDividaUseCase } from './application/alterar-divida.use-case';
import { ListarDividasUseCase } from './application/listar-dividas.use-case';
import type { PerfilGateway } from './application/ports';
import { RemoverDividaUseCase } from './application/remover-divida.use-case';
import type { DividasRepository } from './domain/dividas-repository';
import { createDividasRouter } from './infra/http/dividas.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.
*/

export { InMemoryDividasRepository } from './infra/database/in-memory-dividas-repository';
export type { InMemoryDividasOptions } from './infra/database/in-memory-dividas-repository';
export { PrismaDividasRepository } from './infra/database/prisma-dividas-repository';

export interface DividasModuleDeps {
  dividas: DividasRepository;
  /** o main liga no repositório de perfis (dividas não pode importar perfil: ciclo) */
  perfilGateway: PerfilGateway;
  ids: IdGenerator;
  clock: Clock;
  auth: AuthMiddlewares;
}

export interface DividasModule {
  router: Router;
}

export function createDividasModule(deps: DividasModuleDeps): DividasModule {
  return {
    router: createDividasRouter({
      listar: new ListarDividasUseCase(deps.dividas),
      adicionar: new AdicionarDividaUseCase(deps.dividas, deps.perfilGateway, deps.ids, deps.clock),
      alterar: new AlterarDividaUseCase(deps.dividas),
      remover: new RemoverDividaUseCase(deps.dividas),
      auth: deps.auth,
    }),
  };
}
