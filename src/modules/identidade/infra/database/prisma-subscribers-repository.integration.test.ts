import { afterAll, beforeAll } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { PrismaSubscribersRepository } from './prisma-subscribers-repository';
import { describeSubscribersRepositoryContract } from './subscribers-repository.contract';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

// subscribers é a raiz das FKs: o contrato não precisa de fixture nenhuma
describeSubscribersRepositoryContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  return { repo: new PrismaSubscribersRepository(new PrismaDatabase(db.prisma)) };
});
