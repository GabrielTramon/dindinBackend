import { afterAll, beforeAll } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { insertProfile, insertSubscriber } from '../../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { describeDividasRepositoryContract } from './dividas-repository.contract';
import { PrismaDividasRepository } from './prisma-dividas-repository';

/*
  A trava do replaceAll (SELECT ... FOR NO KEY UPDATE) roda aqui, mas a corrida que
  ela impede não: o PGlite é uma sessão só. A garantia está documentada na interface
  do repositório e foi provada em Postgres real.
*/

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describeDividasRepositoryContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  const repo = new PrismaDividasRepository(new PrismaDatabase(db.prisma));
  return {
    repo,
    criarPerfil: () => insertProfile(db.prisma),
    criarSubscriberSemPerfil: () => insertSubscriber(db.prisma),
  };
});
