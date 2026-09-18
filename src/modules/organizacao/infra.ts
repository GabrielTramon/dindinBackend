import type { Router } from 'express';
import type { Clock } from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import { ObterOrganizacaoUseCase } from './application/obter-organizacao.use-case';
import { SalvarOrganizacaoUseCase } from './application/salvar-organizacao.use-case';
import type { GruposRepository } from './domain/grupos-repository';
import { createOrganizacaoRouter } from './infra/http/organizacao.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.

  Sem TransactionManager: a única escrita é o `replaceAll`, que abre a própria
  transação (ou reaproveita a de fora, quando privacidade estiver apagando a conta).
*/

export { InMemoryGruposRepository } from './infra/database/in-memory-grupos-repository';
export { PrismaGruposRepository } from './infra/database/prisma-grupos-repository';

export interface OrganizacaoModuleDeps {
  grupos: GruposRepository;
  clock: Clock;
  auth: AuthMiddlewares;
}

export interface OrganizacaoModule {
  router: Router;
}

export function createOrganizacaoModule(deps: OrganizacaoModuleDeps): OrganizacaoModule {
  return {
    router: createOrganizacaoRouter({
      obter: new ObterOrganizacaoUseCase(deps.grupos),
      salvar: new SalvarOrganizacaoUseCase(deps.grupos, deps.clock),
      auth: deps.auth,
    }),
  };
}
