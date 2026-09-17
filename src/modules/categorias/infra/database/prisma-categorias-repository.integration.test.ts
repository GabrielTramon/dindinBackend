import { afterAll, beforeAll } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { insertProfile, insertSubscriber } from '../../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { describeCategoriasRepositoryContract } from './categorias-repository.contract';
import { PrismaCategoriasRepository } from './prisma-categorias-repository';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describeCategoriasRepositoryContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  const repo = new PrismaCategoriasRepository(new PrismaDatabase(db.prisma));
  return {
    repo,
    criarSubscriber: () => insertSubscriber(db.prisma),
    colocarEmUso: async (categoriaId, subscriberId) => {
      await insertProfile(db.prisma, subscriberId);
      await db.prisma.gastoFixo.create({ data: { profileId: subscriberId, categoriaId, valor: 10 } });
    },
    idDoCatalogo: async (slug) => (await db.prisma.categoriaGastoFixo.findUniqueOrThrow({ where: { slug } })).id,
  };
});
