import { afterAll, beforeAll } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { insertSubscriber } from '../../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { describePerfisRepositoryContract } from './perfis-repository.contract';
import { PrismaPerfisRepository } from './prisma-perfis-repository';

/*
  O upsert trava a linha do perfil (é o que enfileira PUTs simultâneos na
  sincronização), mas a corrida em si não roda aqui: o PGlite é uma sessão só.
*/

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describePerfisRepositoryContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  const repo = new PrismaPerfisRepository(new PrismaDatabase(db.prisma));
  return {
    repo,
    criarSubscriber: () => insertSubscriber(db.prisma),
  };
});
