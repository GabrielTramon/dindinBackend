import type { Router } from 'express';
import type { Express } from 'express';
import { createApp } from '../main/app';
import { createAuthMiddlewares } from '../shared/infra/http/authentication';
import type { ErrorLogger } from '../shared/infra/http/error-handler';
import {
  FixedClock,
  InMemoryMailer,
  InMemorySessionAccounts,
  InMemoryTransactionManager,
  PredictableSecureTokenGenerator,
  SequentialIdGenerator,
} from '../shared/infra/in-memory/doubles';
import { JwtAuthTokenService } from '../shared/infra/security/jwt-auth-token-service';

/*
  Kit de teste: as portas compartilhadas em memória + um app Express com o
  pipeline de produção (createApp), pronto pra supertest.

    const kit = createTestKit();
    const app = kit.app((api) => api.use(createCategoriasModule({ ...kit.deps, categorias }).router));
    await request(app).get('/api/v1/categorias').set('Authorization', kit.bearer('sub-1'));
*/

export const TEST_JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';

const DIA = 24 * 60 * 60;

export function createTestKit() {
  const clock = new FixedClock();
  const ids = new SequentialIdGenerator();
  const transactions = new InMemoryTransactionManager();
  const mailer = new InMemoryMailer();
  const secureTokens = new PredictableSecureTokenGenerator();
  const authTokens = new JwtAuthTokenService(
    { secret: TEST_JWT_SECRET, sessionTtlSeconds: 30 * DIA, unsubscribeTtlSeconds: 365 * DIA },
    clock,
  );
  const sessionAccounts = new InMemorySessionAccounts();
  const auth = createAuthMiddlewares(authTokens, sessionAccounts);

  /** erros 500 ficam registrados aqui em vez de sujar a saída do teste */
  const unexpectedErrors: unknown[] = [];
  const errorLogger: ErrorLogger = { error: (_msg, context) => unexpectedErrors.push(context) };

  return {
    clock,
    ids,
    transactions,
    mailer,
    secureTokens,
    authTokens,
    sessionAccounts,
    auth,
    unexpectedErrors,
    /** as portas que quase todo módulo recebe */
    deps: { clock, ids, transactions, auth },

    /** header Authorization com uma sessão válida */
    bearer(subscriberId: string): string {
      return `Bearer ${authTokens.issueSession(subscriberId).token}`;
    },

    app(mount: (api: Router) => void): Express {
      return createApp({ mount, corsOrigins: '*', errorLogger });
    },
  };
}

export type TestKit = ReturnType<typeof createTestKit>;
