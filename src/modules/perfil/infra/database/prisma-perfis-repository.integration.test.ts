import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { insertSubscriber } from '../../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../../test/test-database';
import { Perfil, type DadosPerfil } from '../../domain/perfil';
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

/*
  A coluna meta_guardados vista de dentro do banco. O contrato só enxerga o que
  o mapper devolve — e o mapper ignora potes sem meta. Aqui se prova que a
  coluna é APAGADA (NULL de verdade, não o JSON `null`) quando a meta sai, e
  que [] fica gravado como lista vazia, diferente de NULL.
*/
describe('PrismaPerfisRepository — coluna meta_guardados', () => {
  const DADOS: DadosPerfil = {
    rendaMensal: 2800.5,
    tipoRenda: 'clt',
    idade: 24,
    moradia: 'aluguel',
    custoMoradia: 1200,
    guardado: 1000,
  };
  const agora = new Date('2026-09-17T12:00:00.000Z');
  const POTES = [{ id: 'pote-cdb', nome: 'CDB', valor: 1500.75, rendimentoMensal: 0.0085 }];

  let repo: PrismaPerfisRepository;
  beforeEach(async () => {
    await db.reset();
    repo = new PrismaPerfisRepository(new PrismaDatabase(db.prisma));
  });

  const coluna = async (subscriberId: string) =>
    (
      await db.prisma.$queryRaw<{ guardados: unknown; nulo: boolean }[]>`
        SELECT meta_guardados AS guardados, meta_guardados IS NULL AS nulo FROM profiles WHERE subscriber_id = ${subscriberId}`
    )[0];

  it('grava a lista de potes e apaga a coluna (NULL) quando a meta sai', async () => {
    const sub = await insertSubscriber(db.prisma);
    const p = Perfil.criar({ ...DADOS, meta: { tipo: 'carro', valorAlvo: 45_000, guardados: POTES }, subscriberId: sub, agora });
    await repo.save(p);
    expect(await coluna(sub)).toEqual({ guardados: POTES, nulo: false });

    p.substituir(DADOS, agora);
    await repo.save(p);
    expect(await coluna(sub)).toEqual({ guardados: null, nulo: true });
  });

  it('meta sem guardados grava NULL; guardados: [] grava a lista vazia', async () => {
    const [sem, vazio] = [await insertSubscriber(db.prisma), await insertSubscriber(db.prisma)];
    await repo.save(Perfil.criar({ ...DADOS, meta: { tipo: 'carro', valorAlvo: 45_000 }, subscriberId: sem, agora }));
    await repo.save(Perfil.criar({ ...DADOS, meta: { tipo: 'carro', valorAlvo: 45_000, guardados: [] }, subscriberId: vazio, agora }));

    expect(await coluna(sem)).toEqual({ guardados: null, nulo: true });
    expect(await coluna(vazio)).toEqual({ guardados: [], nulo: false });
  });

  it('coluna que não é lista (defeito) vira "não respondeu", sem derrubar a leitura do perfil', async () => {
    const sub = await insertSubscriber(db.prisma);
    await repo.save(Perfil.criar({ ...DADOS, meta: { tipo: 'carro', valorAlvo: 45_000, guardados: POTES }, subscriberId: sub, agora }));
    await db.prisma.$executeRaw`UPDATE profiles SET meta_guardados = '{"lixo": true}'::jsonb WHERE subscriber_id = ${sub}`;

    expect((await repo.findBySubscriberId(sub))?.meta).toStrictEqual({ tipo: 'carro', valorAlvo: 45_000 });
  });
});
