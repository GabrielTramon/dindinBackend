import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { PrismaDatabase, PrismaTransactionManager } from '../../../shared/infra/database/prisma';
import { FixedClock } from '../../../shared/infra/in-memory/doubles';
import { UuidGenerator } from '../../../shared/infra/system';
import { insertSubscriber } from '../../../test/fixtures';
import { startTestDatabase, type TestDatabase } from '../../../test/test-database';
import { PrismaCategoriasRepository } from '../../categorias/infra';
import { PrismaDividasRepository } from '../../dividas/infra';
import { PrismaGastosFixosRepository } from '../../gastos-fixos/infra';
import { PrismaPerfisRepository } from '../infra/database/prisma-perfis-repository';
import { ObterPerfilCompletoUseCase } from './obter-perfil-completo.use-case';
import { CarregarPerfilDoMotorUseCase, type PerfilDoMotor } from './perfil-do-motor';
import { describeSincronizarPerfilCompletoContract } from './sincronizar-perfil-completo.contract';
import { SincronizarPerfilCompletoUseCase } from './sincronizar-perfil-completo.use-case';

/*
  A sincronização contra Postgres, com os repositórios Prisma dos quatro módulos
  e a transação de verdade (PrismaTransactionManager).

  PGlite é uma sessão só: a fila que a gravação do perfil cria entre PUTs
  simultâneos não roda aqui. O que roda é a atomicidade: erro depois de gravar
  o perfil desfaz tudo.
*/

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

function montar() {
  const database = new PrismaDatabase(db.prisma);
  const clock = new FixedClock();
  const perfis = new PrismaPerfisRepository(database);
  const categorias = new PrismaCategoriasRepository(database);
  const gastosFixos = new PrismaGastosFixosRepository(database);
  const dividas = new PrismaDividasRepository(database);
  const carregar = new CarregarPerfilDoMotorUseCase(perfis, gastosFixos, categorias, dividas);
  return {
    clock,
    perfis,
    categorias,
    gastosFixos,
    dividas,
    obterCompleto: new ObterPerfilCompletoUseCase(carregar),
    sincronizar: new SincronizarPerfilCompletoUseCase(
      perfis,
      categorias,
      gastosFixos,
      dividas,
      new PrismaTransactionManager(database),
      new UuidGenerator(),
      clock,
      carregar,
    ),
  };
}

describeSincronizarPerfilCompletoContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  return { ...montar(), criarSubscriber: () => insertSubscriber(db.prisma) };
});

describe('SincronizarPerfilCompletoUseCase — só no Postgres: erro depois de gravar o perfil desfaz tudo', () => {
  let m: ReturnType<typeof montar>;

  beforeEach(async () => {
    await db.reset();
    m = montar();
  });

  const ANTES: PerfilDoMotor = {
    rendaMensal: 2800.5,
    tipoRenda: 'clt',
    idade: 24,
    moradia: 'aluguel',
    custoMoradia: 1200,
    guardado: 1000,
    gastosFixos: [
      { categoria: 'mercado', valor: 450 },
      { categoria: 'outro', nome: 'Padaria', valor: 60 },
    ],
    dividas: [{ tipo: 'rotativo', saldo: 900 }],
  };

  it.each<[string, PerfilDoMotor['gastosFixos'], Record<string, string>]>([
    [
      'soma de duas linhas acima do teto (falha depois de gravar o perfil e ler as categorias)',
      [
        { categoria: 'outro', nome: 'Clube', valor: 600_000 },
        { categoria: 'outro', nome: 'clube', valor: 600_000 },
      ],
      { 'gastosFixos.0.valor': 'Confere esse valor? Está muito alto' },
    ],
    [
      'categoria desconhecida (falha na resolução, depois de gravar o perfil)',
      [
        { categoria: 'luz', valor: 100 },
        { categoria: 'jatinho', valor: 100 },
      ],
      { 'gastosFixos.1.categoria': 'Categoria desconhecida' },
    ],
  ])('%s → ValidationError, e perfil, gastos, dívidas e categorias continuam como antes', async (_caso, gastosFixos, details) => {
    const sub = await insertSubscriber(db.prisma);
    await m.sincronizar.execute({ subscriberId: sub, perfil: ANTES });
    const perfilAntes = (await m.perfis.findBySubscriberId(sub))?.toSnapshot();
    const completoAntes = await m.obterCompleto.execute({ subscriberId: sub });
    const categoriasAntes = (await m.categorias.listVisible(sub)).map((c) => c.toSnapshot());
    m.clock.advance(60_000);

    const falha = m.sincronizar.execute({
      subscriberId: sub,
      perfil: { ...ANTES, rendaMensal: 9000, moradia: 'pais', gastosFixos, dividas: [] },
    });

    await expect(falha).rejects.toBeInstanceOf(ValidationError);
    await expect(falha).rejects.toMatchObject({ details });
    // o perfil tinha sido gravado dentro da transação: continuar igual prova o rollback
    expect((await m.perfis.findBySubscriberId(sub))?.toSnapshot()).toEqual(perfilAntes);
    expect(await m.obterCompleto.execute({ subscriberId: sub })).toEqual(completoAntes);
    expect((await m.categorias.listVisible(sub)).map((c) => c.toSnapshot())).toEqual(categoriasAntes);
  });

  it('a transação não fica presa: depois do erro, o mesmo PUT corrigido grava normalmente', async () => {
    const sub = await insertSubscriber(db.prisma);
    await expect(
      m.sincronizar.execute({ subscriberId: sub, perfil: { ...ANTES, gastosFixos: [{ categoria: 'jatinho', valor: 1 }] } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await m.perfis.exists(sub)).toBe(false);

    const gravado = await m.sincronizar.execute({ subscriberId: sub, perfil: ANTES });
    expect(gravado.gastosFixos).toEqual(ANTES.gastosFixos);
  });
});
