import type { Router } from 'express';
import type { Clock, IdGenerator } from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import { CriarCategoriaPersonalizadaUseCase } from './application/criar-categoria-personalizada.use-case';
import { ExcluirCategoriaUseCase } from './application/excluir-categoria.use-case';
import { ListarCategoriasUseCase } from './application/listar-categorias.use-case';
import { RenomearCategoriaUseCase } from './application/renomear-categoria.use-case';
import type { CategoriasRepository } from './domain/categorias-repository';
import { createCategoriasRouter } from './infra/http/categorias.routes';

/*
  Adaptadores e montagem do módulo. Só o main (composição) importa daqui;
  outros módulos importam os contratos de ./index.
*/

export { InMemoryCategoriasRepository } from './infra/database/in-memory-categorias-repository';
export type { InMemoryCategoriasOptions } from './infra/database/in-memory-categorias-repository';
export { PrismaCategoriasRepository } from './infra/database/prisma-categorias-repository';

export interface CategoriasModuleDeps {
  categorias: CategoriasRepository;
  ids: IdGenerator;
  clock: Clock;
  auth: AuthMiddlewares;
}

export interface CategoriasModule {
  router: Router;
}

export function createCategoriasModule(deps: CategoriasModuleDeps): CategoriasModule {
  return {
    router: createCategoriasRouter({
      listar: new ListarCategoriasUseCase(deps.categorias),
      criar: new CriarCategoriaPersonalizadaUseCase(deps.categorias, deps.ids, deps.clock),
      renomear: new RenomearCategoriaUseCase(deps.categorias),
      excluir: new ExcluirCategoriaUseCase(deps.categorias),
      auth: deps.auth,
    }),
  };
}
