import { afterAll, beforeAll } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { insertSubscriber } from '../../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { describeCheckInsRepositoryContract } from './check-ins-repository.contract';
import { PrismaCheckInsRepository } from './prisma-check-ins-repository';

/*
  A corrida entre duas execuções do job (claimSend) não é testada aqui: o PGlite
  é uma sessão só e roda as "paralelas" em série. A garantia é o WHERE
  enviadoEm IS NULL do updateMany, coberto pelo contrato com leituras
  intercaladas; o não-reenvio é testado no caso de uso.
*/

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describeCheckInsRepositoryContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  const repo = new PrismaCheckInsRepository(new PrismaDatabase(db.prisma));
  return {
    repo,
    criarSubscriber: () => insertSubscriber(db.prisma),
  };
});
