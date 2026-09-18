import { afterAll, beforeAll } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { insertSubscriber } from '../../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { describeGruposRepositoryContract } from './grupos-repository.contract';
import { PrismaGruposRepository } from './prisma-grupos-repository';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describeGruposRepositoryContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  const repo = new PrismaGruposRepository(new PrismaDatabase(db.prisma));
  return {
    repo,
    criarSubscriber: () => insertSubscriber(db.prisma),
  };
});
