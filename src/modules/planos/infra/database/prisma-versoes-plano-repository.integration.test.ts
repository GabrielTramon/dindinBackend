import { afterAll, beforeAll } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { insertSubscriber } from '../../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { PrismaVersoesPlanoRepository } from './prisma-versoes-plano-repository';
import { describeVersoesPlanoRepositoryContract } from './versoes-plano-repository.contract';

/*
  A corrida entre dois recálculos (unique em subscriberId + versao) não é
  testada aqui: o PGlite é uma sessão só e roda as "paralelas" em série. A
  garantia é a constraint do banco, coberta pelo teste de ConflictError do
  contrato; a nova tentativa é testada no caso de uso.
*/

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describeVersoesPlanoRepositoryContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  const repo = new PrismaVersoesPlanoRepository(new PrismaDatabase(db.prisma));
  return {
    repo,
    criarSubscriber: () => insertSubscriber(db.prisma),
  };
});
