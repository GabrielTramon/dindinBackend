import type { Router } from 'express';
import type { Clock, IdGenerator, TransactionManager } from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import type { CategoriasRepository } from '../categorias';
import type { DividasRepository } from '../dividas';
import type { GastosFixosRepository } from '../gastos-fixos';
import { AtualizarPerfilUseCase } from './application/atualizar-perfil.use-case';
import { ObterPerfilCompletoUseCase } from './application/obter-perfil-completo.use-case';
import { ObterPerfilUseCase } from './application/obter-perfil.use-case';
import { CarregarPerfilDoMotorUseCase } from './application/perfil-do-motor';
import { SalvarPerfilUseCase } from './application/salvar-perfil.use-case';
import { SincronizarPerfilCompletoUseCase } from './application/sincronizar-perfil-completo.use-case';
import type { PerfisRepository } from './domain/perfis-repository';
import { createPerfilRouter } from './infra/http/perfil.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.
*/

export { InMemoryPerfisRepository } from './infra/database/in-memory-perfis-repository';
export type { InMemoryPerfisOptions } from './infra/database/in-memory-perfis-repository';
export { PrismaPerfisRepository } from './infra/database/prisma-perfis-repository';
/** o main liga a porta PerfilDoMotorReader de planos a este caso de uso */
export { CarregarPerfilDoMotorUseCase };

export interface PerfilModuleDeps {
  perfis: PerfisRepository;
  gastosFixos: GastosFixosRepository;
  dividas: DividasRepository;
  categorias: CategoriasRepository;
  transactions: TransactionManager;
  ids: IdGenerator;
  clock: Clock;
  auth: AuthMiddlewares;
}

export interface PerfilModule {
  router: Router;
  /** a mesma instância que as rotas usam, pronta pro main entregar a planos */
  carregarPerfilDoMotor: CarregarPerfilDoMotorUseCase;
}

export function createPerfilModule(deps: PerfilModuleDeps): PerfilModule {
  const carregarPerfilDoMotor = new CarregarPerfilDoMotorUseCase(deps.perfis, deps.gastosFixos, deps.categorias, deps.dividas);
  return {
    router: createPerfilRouter({
      obter: new ObterPerfilUseCase(deps.perfis),
      salvar: new SalvarPerfilUseCase(deps.perfis, deps.clock),
      atualizar: new AtualizarPerfilUseCase(deps.perfis, deps.clock),
      obterCompleto: new ObterPerfilCompletoUseCase(carregarPerfilDoMotor),
      sincronizar: new SincronizarPerfilCompletoUseCase(
        deps.perfis,
        deps.categorias,
        deps.gastosFixos,
        deps.dividas,
        deps.transactions,
        deps.ids,
        deps.clock,
        carregarPerfilDoMotor,
      ),
      auth: deps.auth,
    }),
    carregarPerfilDoMotor,
  };
}
