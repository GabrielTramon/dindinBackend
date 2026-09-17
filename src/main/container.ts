import type {
  AuthTokenService,
  Clock,
  IdGenerator,
  Mailer,
  SecureTokenGenerator,
  SessionAccounts,
  TransactionManager,
} from '../shared/application/ports';
import { createPrismaClient, PrismaDatabase, PrismaTransactionManager } from '../shared/infra/database/prisma';
import { InMemoryTransactionManager } from '../shared/infra/in-memory/doubles';
import { ConsoleMailer } from '../shared/infra/mail/console-mailer';
import { ResendMailer } from '../shared/infra/mail/resend-mailer';
import { CryptoSecureTokenGenerator } from '../shared/infra/security/crypto-secure-token-generator';
import { JwtAuthTokenService } from '../shared/infra/security/jwt-auth-token-service';
import { SystemClock, UuidGenerator } from '../shared/infra/system';
import type { CategoriasRepository } from '../modules/categorias';
import { InMemoryCategoriasRepository, PrismaCategoriasRepository } from '../modules/categorias/infra';
import type { AppConfig } from './config';

/*
  Composição: o único lugar que escolhe implementações concretas.

  Tudo abaixo de modules/ recebe interfaces. Trocar Postgres por memória,
  console por Resend, ou o relógio por um fixo nos testes é decisão daqui —
  nenhum caso de uso muda.

  Pra plugar um módulo novo: um campo em Repositories, a implementação Prisma
  em createPrismaRepositories, a em memória em createInMemoryRepositories, e
  as rotas em main/routes.ts.
*/

export interface Repositories {
  categorias: CategoriasRepository;
}

export interface Services {
  clock: Clock;
  ids: IdGenerator;
  transactions: TransactionManager;
  authTokens: AuthTokenService;
  secureTokens: SecureTokenGenerator;
  mailer: Mailer;
  /** conta da sessão ainda existe? (ver authentication.ts) */
  sessionAccounts: SessionAccounts;
}

export interface Container {
  config: AppConfig;
  repositories: Repositories;
  services: Services;
  /** lança se a persistência não estiver respondendo */
  readiness(): Promise<void>;
  close(): Promise<void>;
}

const UM_ANO_EM_SEGUNDOS = 365 * 24 * 60 * 60;

function createMailer(config: AppConfig): Mailer {
  if (config.mail.provider === 'resend') {
    return new ResendMailer({ apiKey: config.mail.resendApiKey ?? '', from: config.mail.from });
  }
  return new ConsoleMailer();
}

function createPrismaRepositories(db: PrismaDatabase): Repositories {
  return {
    categorias: new PrismaCategoriasRepository(db),
  };
}

function createInMemoryRepositories(): Repositories {
  return {
    categorias: new InMemoryCategoriasRepository({ withCatalog: true }),
  };
}

export function createContainer(config: AppConfig): Container {
  const clock = new SystemClock();
  const baseServices = {
    clock,
    ids: new UuidGenerator(),
    authTokens: new JwtAuthTokenService(
      {
        secret: config.jwtSecret,
        sessionTtlSeconds: config.sessionTtlSeconds,
        // o link de descadastro vai em todo e-mail: precisa funcionar num e-mail antigo
        unsubscribeTtlSeconds: UM_ANO_EM_SEGUNDOS,
      },
      clock,
    ),
    secureTokens: new CryptoSecureTokenGenerator(),
    mailer: createMailer(config),
    // PROVISÓRIO até o módulo identidade entrar no container: nenhuma rota emite sessão ainda.
    // A integração troca por { exists: async (id) => (await repositories.subscribers.findById(id)) !== null }.
    sessionAccounts: { exists: async () => true } as SessionAccounts,
  };

  if (config.persistence === 'memoria') {
    return {
      config,
      repositories: createInMemoryRepositories(),
      services: { ...baseServices, transactions: new InMemoryTransactionManager() },
      readiness: async () => {},
      close: async () => {},
    };
  }

  const prisma = createPrismaClient(config.databaseUrl ?? '', { logQueries: false });
  const db = new PrismaDatabase(prisma);
  return {
    config,
    repositories: createPrismaRepositories(db),
    services: { ...baseServices, transactions: new PrismaTransactionManager(db) },
    readiness: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    close: () => prisma.$disconnect(),
  };
}
