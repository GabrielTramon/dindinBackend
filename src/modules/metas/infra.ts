import type { Router } from 'express';
import type { Clock, IdGenerator } from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import { AtualizarMetaUseCase } from './application/atualizar-meta.use-case';
import { CriarMetaUseCase } from './application/criar-meta.use-case';
import { DespublicarMetaUseCase } from './application/despublicar-meta.use-case';
import { ListarMetasUseCase } from './application/listar-metas.use-case';
import { ObterMetaPublicaUseCase } from './application/obter-meta-publica.use-case';
import { ObterMetaUseCase } from './application/obter-meta.use-case';
import { PublicarMetaUseCase } from './application/publicar-meta.use-case';
import { RemoverMetaUseCase } from './application/remover-meta.use-case';
import type { MetasRepository } from './domain/metas-repository';
import { createMetasRouter } from './infra/http/metas.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.
*/

export { InMemoryMetasRepository } from './infra/database/in-memory-metas-repository';
export { PrismaMetasRepository } from './infra/database/prisma-metas-repository';

export interface MetasModuleDeps {
  metas: MetasRepository;
  ids: IdGenerator;
  clock: Clock;
  auth: AuthMiddlewares;
}

export interface MetasModule {
  router: Router;
}

export function createMetasModule(deps: MetasModuleDeps): MetasModule {
  return {
    router: createMetasRouter({
      listar: new ListarMetasUseCase(deps.metas, deps.clock),
      criar: new CriarMetaUseCase(deps.metas, deps.ids, deps.clock),
      obter: new ObterMetaUseCase(deps.metas, deps.clock),
      atualizar: new AtualizarMetaUseCase(deps.metas, deps.clock),
      remover: new RemoverMetaUseCase(deps.metas),
      publicar: new PublicarMetaUseCase(deps.metas, deps.ids, deps.clock),
      despublicar: new DespublicarMetaUseCase(deps.metas, deps.clock),
      obterPublica: new ObterMetaPublicaUseCase(deps.metas),
      auth: deps.auth,
    }),
  };
}
