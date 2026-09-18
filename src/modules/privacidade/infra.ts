import type { Router } from 'express';
import type { Clock, TransactionManager } from '../../shared/application/ports';
import type { AuthMiddlewares } from '../../shared/infra/http/authentication';
import type { CategoriasRepository } from '../categorias';
import type { CheckInsRepository } from '../check-ins';
import type { DividasRepository } from '../dividas';
import type { GastosFixosRepository } from '../gastos-fixos';
import type { SubscribersRepository } from '../identidade';
import type { MetasRepository } from '../metas';
import type { GruposRepository } from '../organizacao';
import type { PerfisRepository } from '../perfil';
import type { VersoesPlanoRepository } from '../planos';
import { ExcluirContaUseCase } from './application/excluir-conta.use-case';
import { ExportarDadosUseCase } from './application/exportar-dados.use-case';
import { createPrivacidadeRouter } from './infra/http/privacidade.routes';

/*
  Montagem do módulo. Só o main (composição) importa daqui; outros módulos
  importam os contratos de ./index.

  Não há adaptador de banco: privacidade não tem tabela própria. Recebe os
  repositórios de todos os módulos — os MESMOS que o container entrega a eles,
  pra exclusão e exportação enxergarem a mesma transação e os mesmos dados.
*/

export interface PrivacidadeModuleDeps {
  subscribers: SubscribersRepository;
  perfis: PerfisRepository;
  gastosFixos: GastosFixosRepository;
  dividas: DividasRepository;
  categorias: CategoriasRepository;
  versoesPlano: VersoesPlanoRepository;
  metas: MetasRepository;
  checkIns: CheckInsRepository;
  grupos: GruposRepository;
  transactions: TransactionManager;
  clock: Clock;
  /**
   * O SessionAccounts por trás destes middlewares precisa ler subscribers.findById:
   * é isso que faz a sessão deixar de valer logo depois da exclusão.
   */
  auth: AuthMiddlewares;
}

export interface PrivacidadeModule {
  router: Router;
}

export function createPrivacidadeModule(deps: PrivacidadeModuleDeps): PrivacidadeModule {
  return {
    router: createPrivacidadeRouter({
      exportar: new ExportarDadosUseCase(
        deps.subscribers,
        deps.perfis,
        deps.gastosFixos,
        deps.categorias,
        deps.dividas,
        deps.versoesPlano,
        deps.metas,
        deps.checkIns,
        deps.grupos,
        deps.clock,
      ),
      excluir: new ExcluirContaUseCase(
        deps.subscribers,
        deps.perfis,
        deps.gastosFixos,
        deps.dividas,
        deps.categorias,
        deps.versoesPlano,
        deps.metas,
        deps.checkIns,
        deps.grupos,
        deps.transactions,
      ),
      auth: deps.auth,
    }),
  };
}
