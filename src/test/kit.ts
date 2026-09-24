import type { Router } from 'express';
import type { Express } from 'express';
import { createApp } from '../main/app';
import { InProcessBackgroundJobs } from '../shared/infra/background-jobs';
import { createAuthMiddlewares } from '../shared/infra/http/authentication';
import type { ErrorLogger } from '../shared/infra/http/error-handler';
import {
  FixedClock,
  InMemoryMailer,
  InMemorySessionAccounts,
  InMemoryTransactionManager,
  PredictablePasswordHasher,
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
  // hash de senha instantâneo e legível ("senha(abc12345)"); o scrypt de verdade roda no e2e
  const passwords = new PredictablePasswordHasher();
  const authTokens = new JwtAuthTokenService(
    { secret: TEST_JWT_SECRET, sessionTtlSeconds: 30 * DIA, unsubscribeTtlSeconds: 365 * DIA },
    clock,
  );
  const sessionAccounts = new InMemorySessionAccounts();
  /** falhas das tarefas em segundo plano (o envio do Esqueci a senha), pra o teste conferir */
  const backgroundFailures: Array<{ message: string; context: Record<string, unknown> }> = [];
  const backgroundJobs = new InProcessBackgroundJobs({
    error: (message, context) => backgroundFailures.push({ message, context }),
  });
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
    passwords,
    authTokens,
    sessionAccounts,
    backgroundJobs,
    backgroundFailures,
    auth,
    unexpectedErrors,
    /** as portas que quase todo módulo recebe */
    deps: { clock, ids, transactions, auth },

    /** header Authorization com uma sessão válida (na versão 0 das sessões, a de toda conta nova) */
    bearer(subscriberId: string, versaoSessao = 0): string {
      return `Bearer ${authTokens.issueSession(subscriberId, versaoSessao).token}`;
    },

    app(mount: (api: Router) => void): Express {
      return createApp({ mount, corsOrigins: '*', errorLogger });
    },
  };
}

export type TestKit = ReturnType<typeof createTestKit>;
