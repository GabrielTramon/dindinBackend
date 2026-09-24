import type { Router } from 'express';
import { createCategoriasModule } from '../modules/categorias/infra';
import { createCheckInsModule } from '../modules/check-ins/infra';
import { createDividasModule } from '../modules/dividas/infra';
import { createGastosFixosModule } from '../modules/gastos-fixos/infra';
import { createIdentidadeModule } from '../modules/identidade/infra';
import { createMetasModule } from '../modules/metas/infra';
import { createOrganizacaoModule } from '../modules/organizacao/infra';
import { createPerfilModule } from '../modules/perfil/infra';
import { createPlanosModule } from '../modules/planos/infra';
import { createPrivacidadeModule } from '../modules/privacidade/infra';
import { createAuthMiddlewares } from '../shared/infra/http/authentication';
import type { Container } from './container';

/*
  Pluga cada módulo em /api/v1. Cada router declara os próprios caminhos
  completos (/categorias, /perfil/gastos-fixos…) e não há dois routers
  disputando o mesmo caminho, então a ordem aqui não importa — a lista de
  endpoints está no README.

  Aqui também se ligam as portas que existem pra evitar ciclo entre módulos
  (ver o grafo no CLAUDE.md):
  - gastos-fixos e dividas perguntam "o perfil existe?" → PerfisRepository.exists;
  - planos lê o perfil completo no formato do motor → CarregarPerfilDoMotorUseCase de perfil.
*/

export function mountModules(api: Router, container: Container): void {
  const { config, repositories: r, services: s } = container;
  // um par de middlewares pra todos: a sessão confere a MESMA tabela de subscribers que privacidade apaga
  const auth = createAuthMiddlewares(s.authTokens, s.sessionAccounts);
  const common = { clock: s.clock, ids: s.ids, auth };
  const perfilGateway = { exists: (subscriberId: string) => r.perfis.exists(subscriberId) };

  api.use(
    createIdentidadeModule({
      ...common,
      subscribers: r.subscribers,
      secureTokens: s.secureTokens,
      authTokens: s.authTokens,
      passwords: s.passwords,
      mailer: s.mailer,
      backgroundJobs: s.backgroundJobs,
      config: {
        appUrl: config.appUrl,
        confirmationLinkTtlHours: config.confirmationLinkTtlHours,
        resetLinkTtlMinutes: config.resetLinkTtlMinutes,
        linkResendCooldownSeconds: config.linkResendCooldownSeconds,
      },
      // o limite usa req.ip: atrás de proxy, TRUST_PROXY precisa estar certo
      rateLimit: { enabled: config.rateLimitEnabled },
    }).router,
  );

  api.use(createCategoriasModule({ ...common, categorias: r.categorias }).router);

  const perfil = createPerfilModule({
    ...common,
    transactions: s.transactions,
    perfis: r.perfis,
    gastosFixos: r.gastosFixos,
    dividas: r.dividas,
    categorias: r.categorias,
  });
  api.use(perfil.router);

  api.use(
    createGastosFixosModule({ ...common, gastosFixos: r.gastosFixos, categorias: r.categorias, perfilGateway }).router,
  );
  api.use(createDividasModule({ ...common, dividas: r.dividas, perfilGateway }).router);

  api.use(
    createPlanosModule({
      ...common,
      versoesPlano: r.versoesPlano,
      perfilReader: { load: (subscriberId) => perfil.carregarPerfilDoMotor.execute({ subscriberId }) },
    }).router,
  );

  api.use(createMetasModule({ ...common, metas: r.metas }).router);

  api.use(createCheckInsModule({ ...common, checkIns: r.checkIns, versoesPlano: r.versoesPlano }).router);

  // organizacao não depende de ninguém: guarda a árvore de grupos do excedente.
  // O `ids` que vem no spread é ignorado — o id do grupo vem do cliente, porque
  // é o mesmo do localStorage e é o que faz a árvore sobreviver ao round-trip.
  api.use(createOrganizacaoModule({ ...common, grupos: r.grupos }).router);

  api.use(
    createPrivacidadeModule({
      clock: s.clock,
      auth,
      transactions: s.transactions,
      subscribers: r.subscribers,
      perfis: r.perfis,
      gastosFixos: r.gastosFixos,
      dividas: r.dividas,
      categorias: r.categorias,
      versoesPlano: r.versoesPlano,
      metas: r.metas,
      checkIns: r.checkIns,
      grupos: r.grupos,
    }).router,
  );
}
