import { afterAll, beforeAll } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { insertProfile, insertSubscriber } from '../../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { describeGastosFixosRepositoryContract } from './gastos-fixos-repository.contract';
import { PrismaGastosFixosRepository } from './prisma-gastos-fixos-repository';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describeGastosFixosRepositoryContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  const repo = new PrismaGastosFixosRepository(new PrismaDatabase(db.prisma));
  return {
    repo,
    criarPerfil: () => insertProfile(db.prisma),
    criarSubscriberSemPerfil: () => insertSubscriber(db.prisma),
    idDoCatalogo: async (slug) => (await db.prisma.categoriaGastoFixo.findUniqueOrThrow({ where: { slug } })).id,
    // só satisfaz a FK: a regra de nome é do módulo categorias
    criarCategoriaPersonalizada: async (subscriberId, nome) =>
      (await db.prisma.categoriaGastoFixo.create({ data: { nome, subscriberId } })).id,
  };
});
