import { afterAll, beforeAll } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { insertSubscriber } from '../../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { describeMetasRepositoryContract } from './metas-repository.contract';
import { PrismaMetasRepository } from './prisma-metas-repository';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describeMetasRepositoryContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  const repo = new PrismaMetasRepository(new PrismaDatabase(db.prisma));
  return {
    repo,
    criarSubscriber: () => insertSubscriber(db.prisma),
  };
});
