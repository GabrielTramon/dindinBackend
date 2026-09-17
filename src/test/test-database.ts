/*
  Postgres de verdade pros testes de integração, sem Docker e sem senha.

  PGlite (PostgreSQL 18.3 compilado pra WASM, dentro do processo) servido por TCP
  com @electric-sql/pglite-socket, e o MESMO PrismaClient gerado + @prisma/adapter-pg
  da produção, conectando por URL. Validado num spike: migrations, Decimal, enum,
  Json, P2002, P2003 (Restrict), transação interativa com rollback e cascade.

  Uso, num *.integration.test.ts (rodado por `yarn test:integration`):

    let db: TestDatabase;
    beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
    beforeEach(() => db.reset());
    afterAll(() => db.close());

    const repo = new PrismaXRepository(new PrismaDatabase(db.prisma));

  Custo: ~1,3 s na primeira vez na máquina (initdb); depois ~0,5 s por arquivo
  (template em cache no tmpdir); reset() ~6 ms; query simples ~0,8 ms.

  O QUE ESTE BANCO NÃO REPRODUZ — continua exigindo Postgres real (CI/Docker):
    · concorrência: PGlite é UMA sessão; transações "paralelas" rodam em série.
      Corrida entre dois pedidos, SELECT ... FOR UPDATE, níveis de isolamento: não teste aqui.
    · versão: PGlite é Postgres 18; produção pode ser 16. SQL exclusivo do 17/18 passa aqui e quebra lá.

  ARMADILHAS (todas reproduzidas no spike):
   1. FUSO: o PGlite herda o fuso da máquina (Etc/GMT+3 aqui). DEFAULT CURRENT_TIMESTAMP
      gravava 3 h errado. Conserto: postgresqlconf timezone='UTC' em TODO create,
      inclusive o que carrega o template. SET TIME ZONE não entra no dump.
   2. pglite-socket aceita 1 conexão por padrão e o pool do pg abre até 10 → P1017.
      E o pg-pool destrói a conexão a cada erro de query, liberando a vaga só num
      setImmediate. Por isso maxConnections 32 com pool max 1.
   3. Usar o prisma raiz dentro de $transaction(tx => ...) trava até o timeout (P2028).
      O PrismaDatabase evita com um AsyncLocalStorage por PrismaClient — código que
      usar `db.prisma` direto dentro de TransactionManager.run trava aqui.
   4. SET de sessão vaza pra todas as conexões. Não use ?schema= diferente de public.
   5. migration.sql não é reexecutável (CREATE TYPE → 42710). Cada uma roda uma vez, em ordem.
   6. TRUNCATE subscribers CASCADE esvazia categorias_gasto_fixo INTEIRA, catálogo junto.
      reset() restaura um snapshot das tabelas semeadas com os mesmos ids.
   7. JSONB reordena chaves: compare Json com toEqual, nunca JSON.stringify.
   8. Decimal volta Prisma.Decimal ('2800.50' → toString '2800.5'); count(*) cru volta bigint.
   9. Com driver adapter, P2002 não tem meta.target (fica em meta.driverAdapterError.cause).
  10. 127.0.0.1, não localhost: o servidor só escuta IPv4.
  11. Declare @electric-sql/pglite 0.5.8 e pglite-socket 0.2.11 em devDependencies:
      sem isso o import resolve a 0.4.3 transitiva do @prisma/dev (Postgres 17).
  12. Chame $disconnect antes de parar o servidor: stop() não espera os sockets.
*/

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export interface TestDatabase {
  /** postgresql://…@127.0.0.1:<porta livre>/postgres — pra DATABASE_URL quando testar a app inteira */
  url: string;
  /** client pronto (pool max 1) */
  prisma: PrismaClient;
  /** acesso direto, fora do socket */
  pglite: PGlite;
  /** volta ao estado "logo depois das migrations": tabelas vazias + catálogo semeado */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export interface TestDatabaseOptions {
  migrationsDir?: string;
  poolMax?: number;
  maxConnections?: number;
  /** template em os.tmpdir() entre processos (padrão: sim; PGLITE_TEMPLATE_CACHE=0 desliga) */
  diskCache?: boolean;
  log?: Prisma.PrismaClientOptions['log'];
}

const SEED_SCHEMA = '_teste_seed';
/** mude quando mudar o que entra no template (v2: fuso UTC) */
const TEMPLATE_FORMAT = 'v2-utc';
const UTC: string[] = ["timezone = 'UTC'"];

interface Migration {
  name: string;
  sql: string;
}

function readMigrations(dir: string): Migration[] {
  if (!existsSync(dir)) throw new Error(`pasta de migrations não existe: ${dir}`);
  const migrations = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort() // mesma ordem do prisma migrate: nome da pasta, com o timestamp na frente
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name, 'migration.sql'), 'utf8') }));
  if (migrations.length === 0) throw new Error(`nenhuma migration.sql em ${dir}`);
  return migrations;
}

function pgliteVersion(): string {
  try {
    const entry = createRequire(__filename).resolve('@electric-sql/pglite');
    return JSON.parse(readFileSync(path.join(path.dirname(entry), '..', 'package.json'), 'utf8')).version;
  } catch {
    return 'desconhecida';
  }
}

function templateKey(migrations: Migration[]): string {
  const hash = createHash('sha256').update(`${TEMPLATE_FORMAT}|pglite@${pgliteVersion()}`);
  for (const m of migrations) hash.update(`\0${m.name}\0${m.sql}`);
  return hash.digest('hex').slice(0, 16);
}

async function publicTables(db: PGlite, schema = 'public'): Promise<string[]> {
  const { rows } = await db.query<{ t: string }>(
    `SELECT tablename AS t FROM pg_tables WHERE schemaname = $1 AND tablename <> '_prisma_migrations' ORDER BY 1`,
    [schema],
  );
  return rows.map((r) => r.t);
}

/** initdb + todas as migrations + snapshot das tabelas que ficaram com linhas (o seed) */
async function buildFromScratch(migrations: Migration[]): Promise<PGlite> {
  const db = await PGlite.create({ postgresqlconf: UTC });
  try {
    for (const m of migrations) {
      try {
        await db.exec(m.sql);
      } catch (e) {
        throw new Error(`migration ${m.name} falhou no PGlite: ${(e as Error).message}`);
      }
    }
    const seeded: string[] = [];
    for (const t of await publicTables(db)) {
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public."${t}"`);
      if ((rows[0]?.n ?? 0) > 0) seeded.push(t);
    }
    await db.exec(
      `CREATE SCHEMA "${SEED_SCHEMA}";\n` +
        seeded.map((t) => `CREATE TABLE "${SEED_SCHEMA}"."${t}" AS SELECT * FROM public."${t}";`).join('\n'),
    );
    return db;
  } catch (e) {
    await db.close();
    throw e;
  }
}

const templates = new Map<string, Blob>();

/*
  Do mais barato pro mais caro:
    1. template em memória neste processo       → loadDataDir (~0,2 s)
    2. template no tmpdir de uma execução anterior → loadDataDir (~0,5 s)
    3. nada → initdb + migrations (~1,3 s); o dump alimenta 1 e 2
*/
async function openPglite(migrations: Migration[], diskCache: boolean): Promise<PGlite> {
  const key = templateKey(migrations);
  const file = path.join(tmpdir(), 'dindin-pglite-template', `${key}.tar.gz`);

  const inMemory = templates.get(key);
  if (inMemory) return PGlite.create({ loadDataDir: inMemory, postgresqlconf: UTC });

  if (diskCache && existsSync(file)) {
    try {
      const blob = new Blob([readFileSync(file)]);
      const db = await PGlite.create({ loadDataDir: blob, postgresqlconf: UTC });
      templates.set(key, blob);
      return db;
    } catch {
      rmSync(file, { force: true }); // outra versão, corrompido ou travado: reconstrói
    }
  }

  const db = await buildFromScratch(migrations);
  const blob = await db.dumpDataDir(diskCache ? 'gzip' : 'none');
  templates.set(key, blob);
  if (diskCache) {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      // grava ao lado e renomeia: worker paralelo nunca lê arquivo pela metade
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));
      renameSync(tmp, file);
    } catch {
      /* outro worker ganhou a corrida: segue com o template em memória */
    }
  }
  return db;
}

export async function startTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const migrationsDir = options.migrationsDir ?? path.resolve(__dirname, '../../prisma/migrations');
  const diskCache = options.diskCache ?? process.env.PGLITE_TEMPLATE_CACHE !== '0';
  const pglite = await openPglite(readMigrations(migrationsDir), diskCache);

  const server = new PGLiteSocketServer({
    db: pglite,
    host: '127.0.0.1',
    port: 0, // porta livre escolhida pelo SO: arquivos em paralelo não brigam
    maxConnections: options.maxConnections ?? 32,
  });
  try {
    await server.start();
  } catch (e) {
    await pglite.close();
    throw e;
  }
  const url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: options.poolMax ?? 1 }),
    log: options.log ?? ['warn', 'error'],
  });

  const tables = await publicTables(pglite);
  const seeded = await publicTables(pglite, SEED_SCHEMA);
  const resetSql = [
    'BEGIN;',
    // desliga triggers de FK só nesta transação: SET LOCAL não vaza pra sessão
    'SET LOCAL session_replication_role = replica;',
    tables.length ? `TRUNCATE TABLE ${tables.map((t) => `public."${t}"`).join(', ')} RESTART IDENTITY CASCADE;` : '',
    ...seeded.map((t) => `INSERT INTO public."${t}" SELECT * FROM "${SEED_SCHEMA}"."${t}";`),
    'COMMIT;',
  ].join('\n');

  let closed = false;

  return {
    url,
    prisma,
    pglite,
    async reset() {
      // teste que largou transação aberta faria o reset rodar dentro dela
      if (pglite.isInTransaction()) await pglite.exec('ROLLBACK');
      try {
        await pglite.exec(resetSql);
      } catch (e) {
        if (pglite.isInTransaction()) await pglite.exec('ROLLBACK');
        throw e;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await prisma.$disconnect().catch(() => {});
      await server.stop();
      await pglite.close();
    },
  };
}
