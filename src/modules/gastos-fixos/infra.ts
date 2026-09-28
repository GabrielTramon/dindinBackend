import type { Router } from 'express';
import type { Clock, IdGenerator } from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import type { CategoriasRepository } from '../categorias';
import { AdicionarGastoFixoUseCase } from './application/adicionar-gasto-fixo.use-case';
import { AlterarGastoFixoUseCase } from './application/alterar-gasto-fixo.use-case';
import { ListarGastosFixosUseCase } from './application/listar-gastos-fixos.use-case';
import type { PerfilGateway } from './application/ports';
import { RemoverGastoFixoUseCase } from './application/remover-gasto-fixo.use-case';
import type { GastosFixosRepository } from './domain/gastos-fixos-repository';
import { createGastosFixosRouter } from './infra/http/gastos-fixos.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.
*/

export { InMemoryGastosFixosRepository } from './infra/database/in-memory-gastos-fixos-repository';
export type { InMemoryGastosFixosOptions } from './infra/database/in-memory-gastos-fixos-repository';
export { PrismaGastosFixosRepository } from './infra/database/prisma-gastos-fixos-repository';

export interface GastosFixosModuleDeps {
  gastosFixos: GastosFixosRepository;
  categorias: CategoriasRepository;
  /** o main liga no repositório de perfis (a porta existe pra não criar ciclo com perfil) */
  perfilGateway: PerfilGateway;
  ids: IdGenerator;
  clock: Clock;
  auth: AuthMiddlewares;
}

export interface GastosFixosModule {
  router: Router;
}

export function createGastosFixosModule(deps: GastosFixosModuleDeps): GastosFixosModule {
  return {
    router: createGastosFixosRouter({
      listar: new ListarGastosFixosUseCase(deps.gastosFixos, deps.categorias),
      adicionar: new AdicionarGastoFixoUseCase(deps.gastosFixos, deps.categorias, deps.perfilGateway, deps.ids, deps.clock),
      alterar: new AlterarGastoFixoUseCase(deps.gastosFixos, deps.categorias),
      remover: new RemoverGastoFixoUseCase(deps.gastosFixos),
      auth: deps.auth,
    }),
  };
}
