import type { Router } from 'express';
import { createCategoriasModule } from '../modules/categorias/infra';
import { createAuthMiddlewares } from '../shared/infra/http/authentication';
import type { Container } from './container';

/*
  Pluga cada módulo em /api/v1. Cada router declara os próprios caminhos
  completos (/categorias, /perfil/gastos-fixos…), então a ordem aqui não
  importa — a lista de endpoints está no README.
*/

export function mountModules(api: Router, container: Container): void {
  const { repositories: r, services: s } = container;
  const auth = createAuthMiddlewares(s.authTokens, s.sessionAccounts);
  const common = { clock: s.clock, ids: s.ids, auth };

  api.use(createCategoriasModule({ ...common, categorias: r.categorias }).router);
}
