import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../../generated/prisma/client';
import type { TransactionManager } from '../../application/ports';

/*
  Acesso ao Postgres.

  Repositórios nunca guardam o PrismaClient direto: pedem `db.client` a cada
  operação. Dentro de `TransactionManager.run`, esse cliente é o da transação
  (guardado num AsyncLocalStorage); fora, é o cliente raiz. Assim o caso de uso
  decide o que é atômico sem que nenhum repositório receba `tx` por parâmetro.

  A transação é do PrismaClient, não da instância de PrismaDatabase: qualquer
  PrismaDatabase criado sobre o mesmo cliente enxerga a transação aberta. Com um
  store por instância, um repositório montado com outro `new PrismaDatabase(prisma)`
  escapava da transação em silêncio — e no Postgres real gravava em autocommit.

  Dentro de `run`, NUNCA capture um erro de banco e siga usando a transação: no
  Postgres, depois de qualquer erro a transação fica abortada (25P02) e toda
  consulta seguinte falha. Pra tentar de novo, repita o `run` inteiro.
*/

export type DbClient = PrismaClient | Prisma.TransactionClient;

// um store por cliente; clientes diferentes (dois bancos de teste) não se misturam
const transactionStores = new WeakMap<PrismaClient, AsyncLocalStorage<Prisma.TransactionClient>>();

function transactionStoreOf(root: PrismaClient): AsyncLocalStorage<Prisma.TransactionClient> {
  let store = transactionStores.get(root);
  if (!store) {
    store = new AsyncLocalStorage<Prisma.TransactionClient>();
    transactionStores.set(root, store);
  }
  return store;
}

export function createPrismaClient(databaseUrl: string, options: { logQueries?: boolean } = {}): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

export class PrismaDatabase {
  private readonly transactionStore: AsyncLocalStorage<Prisma.TransactionClient>;

  constructor(readonly root: PrismaClient) {
    this.transactionStore = transactionStoreOf(root);
  }

  /** O cliente da transação em andamento, ou o raiz. */
  get client(): DbClient {
    return this.transactionStore.getStore() ?? this.root;
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    // aninhada: já existe uma transação aberta nesta cadeia assíncrona
    if (this.transactionStore.getStore()) return work();
    return this.root.$transaction((tx) => this.transactionStore.run(tx, work), {
      maxWait: 5_000,
      timeout: 15_000,
    });
  }
}

export class PrismaTransactionManager implements TransactionManager {
  constructor(private readonly db: PrismaDatabase) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
