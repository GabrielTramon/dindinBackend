import type {
  AuthTokenService,
  BackgroundJobs,
  Clock,
  IdGenerator,
  Mailer,
  PasswordHasher,
  SecureTokenGenerator,
  SessionAccounts,
  TransactionManager,
} from '../shared/application/ports';
import { InProcessBackgroundJobs } from '../shared/infra/background-jobs';
import { createPrismaClient, PrismaDatabase, PrismaTransactionManager } from '../shared/infra/database/prisma';
import { InMemoryTransactionManager } from '../shared/infra/in-memory/doubles';
import { ConsoleMailer } from '../shared/infra/mail/console-mailer';
import { ResendMailer } from '../shared/infra/mail/resend-mailer';
import { CryptoSecureTokenGenerator } from '../shared/infra/security/crypto-secure-token-generator';
import { JwtAuthTokenService } from '../shared/infra/security/jwt-auth-token-service';
import { ScryptPasswordHasher } from '../shared/infra/security/scrypt-password-hasher';
import { SystemClock, UuidGenerator } from '../shared/infra/system';
import type { CategoriasRepository } from '../modules/categorias';
import { InMemoryCategoriasRepository, PrismaCategoriasRepository } from '../modules/categorias/infra';
import type { CheckInsRepository } from '../modules/check-ins';
import { InMemoryCheckInsRepository, PrismaCheckInsRepository } from '../modules/check-ins/infra';
import type { DividasRepository } from '../modules/dividas';
import { InMemoryDividasRepository, PrismaDividasRepository } from '../modules/dividas/infra';
import type { GastosFixosRepository } from '../modules/gastos-fixos';
import { InMemoryGastosFixosRepository, PrismaGastosFixosRepository } from '../modules/gastos-fixos/infra';
import type { SubscribersRepository } from '../modules/identidade';
import { InMemorySubscribersRepository, PrismaSubscribersRepository } from '../modules/identidade/infra';
import type { MetasRepository } from '../modules/metas';
import { InMemoryMetasRepository, PrismaMetasRepository } from '../modules/metas/infra';
import type { GruposRepository } from '../modules/organizacao';
import { InMemoryGruposRepository, PrismaGruposRepository } from '../modules/organizacao/infra';
import type { PerfisRepository } from '../modules/perfil';
import { InMemoryPerfisRepository, PrismaPerfisRepository } from '../modules/perfil/infra';
import type { VersoesPlanoRepository } from '../modules/planos';
import { InMemoryVersoesPlanoRepository, PrismaVersoesPlanoRepository } from '../modules/planos/infra';
import type { AppConfig } from './config';

/*
  Composição: o único lugar que escolhe implementações concretas.

  Tudo abaixo de modules/ recebe interfaces. Trocar Postgres por memória,
  console por Resend, ou o relógio por um fixo nos testes é decisão daqui —
  nenhum caso de uso muda.

  Pra plugar um módulo novo: um campo em Repositories, a implementação Prisma
  em createPrismaRepositories, a em memória em createInMemoryRepositories, e
  as rotas em main/routes.ts.

  Cada módulo recebe a MESMA instância de cada repositório (privacidade apaga
  com os mesmos objetos que os outros módulos gravam), e no Postgres todos
  ficam sobre UM PrismaDatabase: a transação aberta por um caso de uso vale
  pra todos os repositórios que ele chamar.
*/

export interface Repositories {
  subscribers: SubscribersRepository;
  categorias: CategoriasRepository;
  perfis: PerfisRepository;
  gastosFixos: GastosFixosRepository;
  dividas: DividasRepository;
  versoesPlano: VersoesPlanoRepository;
  metas: MetasRepository;
  checkIns: CheckInsRepository;
  grupos: GruposRepository;
}

export interface Services {
  clock: Clock;
  ids: IdGenerator;
  transactions: TransactionManager;
  authTokens: AuthTokenService;
  secureTokens: SecureTokenGenerator;
  /** hash de senha (scrypt); os testes de caso de uso trocam por um instantâneo */
  passwords: PasswordHasher;
  mailer: Mailer;
  /** a sessão ainda vale? conta existe e a senha não mudou depois do token (ver authentication.ts) */
  sessionAccounts: SessionAccounts;
  /** o que sai do caminho da resposta (o e-mail do Esqueci a senha); os testes esperam com idle() */
  backgroundJobs: BackgroundJobs;
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
    subscribers: new PrismaSubscribersRepository(db),
    categorias: new PrismaCategoriasRepository(db),
    perfis: new PrismaPerfisRepository(db),
    gastosFixos: new PrismaGastosFixosRepository(db),
    dividas: new PrismaDividasRepository(db),
    versoesPlano: new PrismaVersoesPlanoRepository(db),
    metas: new PrismaMetasRepository(db),
    checkIns: new PrismaCheckInsRepository(db),
    grupos: new PrismaGruposRepository(db),
  };
}

/*
  Em memória não há FK: cada repositório recebe por callback a pergunta que o
  Postgres responderia (a conta existe? o perfil existe? a categoria está em
  uso?). É isso que faz a ordem da exclusão (LGPD) e o "crie seu perfil antes"
  se comportarem igual nos dois modos.

  categorias e gastosFixos se enxergam: a categoria pergunta se tem gasto
  (Restrict) e o gasto pergunta se a categoria existe. As closures só rodam
  depois que os dois existem, então declarar um antes do outro basta.
*/
function createInMemoryRepositories(): Repositories {
  const subscribers = new InMemorySubscribersRepository();
  const contaExiste = async (subscriberId: string) => (await subscribers.findById(subscriberId)) !== null;

  const perfis = new InMemoryPerfisRepository({ subscriberExists: contaExiste });
  const categorias: InMemoryCategoriasRepository = new InMemoryCategoriasRepository({
    withCatalog: true,
    isInUse: (categoriaId) => gastosFixos.existsForCategory(categoriaId),
  });
  const gastosFixos: InMemoryGastosFixosRepository = new InMemoryGastosFixosRepository({
    perfilExists: (subscriberId) => perfis.exists(subscriberId),
    categoriaExists: async (categoriaId) => (await categorias.findById(categoriaId)) !== null,
  });

  return {
    subscribers,
    categorias,
    perfis,
    gastosFixos,
    dividas: new InMemoryDividasRepository({ perfilExists: (subscriberId) => perfis.exists(subscriberId) }),
    versoesPlano: new InMemoryVersoesPlanoRepository(),
    metas: new InMemoryMetasRepository(),
    checkIns: new InMemoryCheckInsRepository({ subscriberExists: contaExiste }),
    // sem callback: a única FK de grupos é o dono, e quem chega aqui já passou
    // pelo requireAuth, que confere se a conta existe
    grupos: new InMemoryGruposRepository(),
  };
}

/**
 * Sessão só vale enquanto a conta existe e na versão atual dela: o JWT não é
 * revogável, a exclusão (LGPD) é física e a senha nova encerra as sessões de
 * antes. Uma busca por chave primária a cada requisição autenticada.
 */
function sessionAccountsOf(repositories: Repositories): SessionAccounts {
  return {
    sessionVersion: async (subscriberId) => (await repositories.subscribers.findById(subscriberId))?.versaoSessao ?? null,
  };
}

/**
 * @param overrides troca serviços prontos — nos testes, um relógio fixo e um
 *   e-mail em memória. O relógio trocado vale também pros tokens assinados.
 */
export function createContainer(config: AppConfig, overrides: Partial<Services> = {}): Container {
  const clock = overrides.clock ?? new SystemClock();
  const base = {
    clock,
    ids: overrides.ids ?? new UuidGenerator(),
    authTokens:
      overrides.authTokens ??
      new JwtAuthTokenService(
        {
          secret: config.jwtSecret,
          sessionTtlSeconds: config.sessionTtlSeconds,
          // o link de descadastro vai em todo e-mail: precisa funcionar num e-mail antigo
          unsubscribeTtlSeconds: UM_ANO_EM_SEGUNDOS,
        },
        clock,
      ),
    secureTokens: overrides.secureTokens ?? new CryptoSecureTokenGenerator(),
    passwords: overrides.passwords ?? new ScryptPasswordHasher(),
    mailer: overrides.mailer ?? createMailer(config),
    backgroundJobs: overrides.backgroundJobs ?? new InProcessBackgroundJobs(),
  };

  if (config.persistence === 'memoria') {
    const repositories = createInMemoryRepositories();
    return {
      config,
      repositories,
      services: {
        ...base,
        transactions: overrides.transactions ?? new InMemoryTransactionManager(),
        sessionAccounts: overrides.sessionAccounts ?? sessionAccountsOf(repositories),
      },
      readiness: async () => {},
      close: () => base.backgroundJobs.idle(),
    };
  }

  const prisma = createPrismaClient(config.databaseUrl ?? '', { logQueries: false });
  const db = new PrismaDatabase(prisma);
  const repositories = createPrismaRepositories(db);
  return {
    config,
    repositories,
    services: {
      ...base,
      transactions: overrides.transactions ?? new PrismaTransactionManager(db),
      sessionAccounts: overrides.sessionAccounts ?? sessionAccountsOf(repositories),
    },
    readiness: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    close: async () => {
      // o e-mail que ainda está saindo termina antes de o banco fechar
      await base.backgroundJobs.idle();
      await prisma.$disconnect();
    },
  };
}
