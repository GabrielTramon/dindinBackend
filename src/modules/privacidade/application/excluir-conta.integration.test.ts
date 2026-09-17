import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaDatabase, PrismaTransactionManager } from '../../../shared/infra/database/prisma';
import { FixedClock } from '../../../shared/infra/in-memory/doubles';
import { UuidGenerator } from '../../../shared/infra/system';
import { startTestDatabase, type TestDatabase } from '../../../test/test-database';
import { PrismaCategoriasRepository } from '../../categorias/infra';
import { PrismaCheckInsRepository } from '../../check-ins/infra';
import { PrismaDividasRepository } from '../../dividas/infra';
import { PrismaGastosFixosRepository } from '../../gastos-fixos/infra';
import { PrismaSubscribersRepository } from '../../identidade/infra';
import { PrismaMetasRepository } from '../../metas/infra';
import { PrismaPerfisRepository } from '../../perfil/infra';
import { PrismaVersoesPlanoRepository } from '../../planos/infra';
import { CONFIRMACAO_EXCLUSAO, ExcluirContaUseCase } from './excluir-conta.use-case';
import { ExportarDadosUseCase } from './exportar-dados.use-case';
import {
  ANA,
  BRUNO,
  CONTA_COMPLETA,
  criarContaCompleta,
  describePrivacidadeContract,
  retratoDa,
  type PrivacidadeHarness,
} from './privacidade.contract';

/*
  Exportar e excluir contra Postgres, com os repositórios Prisma dos oito módulos
  sobre UM PrismaDatabase e a transação de verdade (PrismaTransactionManager).

  Aqui aparece o que a memória não mostra: as FKs reais (o Restrict de
  gastos_fixos.categoria_id), a contagem crua de cada tabela — linha órfã
  inclusive — e o rollback quando algo falha no meio da exclusão.
*/

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

type CriarSubscribers = (database: PrismaDatabase) => PrismaSubscribersRepository;

function montar(criarSubscribers: CriarSubscribers = (database) => new PrismaSubscribersRepository(database)) {
  const database = new PrismaDatabase(db.prisma);
  const clock = new FixedClock();
  const subscribers = criarSubscribers(database);
  const perfis = new PrismaPerfisRepository(database);
  const categorias = new PrismaCategoriasRepository(database);
  const gastosFixos = new PrismaGastosFixosRepository(database);
  const dividas = new PrismaDividasRepository(database);
  const versoesPlano = new PrismaVersoesPlanoRepository(database);
  const metas = new PrismaMetasRepository(database);
  const checkIns = new PrismaCheckInsRepository(database);
  const harness: PrivacidadeHarness = {
    subscribers,
    perfis,
    categorias,
    gastosFixos,
    dividas,
    versoesPlano,
    metas,
    checkIns,
    ids: new UuidGenerator(),
    clock,
    exportar: new ExportarDadosUseCase(
      subscribers,
      perfis,
      gastosFixos,
      categorias,
      dividas,
      versoesPlano,
      metas,
      checkIns,
      clock,
    ),
    excluir: new ExcluirContaUseCase(
      subscribers,
      perfis,
      gastosFixos,
      dividas,
      categorias,
      versoesPlano,
      metas,
      checkIns,
      new PrismaTransactionManager(database),
    ),
  };
  return harness;
}

describePrivacidadeContract('Prisma (Postgres/PGlite)', async () => {
  await db.reset();
  return montar();
});

/** Linhas de cada tabela que pertencem à pessoa, contadas direto no banco. */
async function linhasDa(subscriberId: string) {
  const p = db.prisma;
  return {
    subscribers: await p.subscriber.count({ where: { id: subscriberId } }),
    profiles: await p.profile.count({ where: { subscriberId } }),
    categorias_gasto_fixo: await p.categoriaGastoFixo.count({ where: { subscriberId } }),
    gastos_fixos: await p.gastoFixo.count({ where: { profileId: subscriberId } }),
    dividas: await p.divida.count({ where: { profileId: subscriberId } }),
    plans: await p.plan.count({ where: { subscriberId } }),
    goals: await p.goal.count({ where: { subscriberId } }),
    check_ins: await p.checkIn.count({ where: { subscriberId } }),
  };
}

/** Todas as linhas de cada tabela, de qualquer dono; o catálogo separado das personalizadas. */
async function linhasNoBanco() {
  const p = db.prisma;
  return {
    subscribers: await p.subscriber.count(),
    profiles: await p.profile.count(),
    categorias_gasto_fixo: await p.categoriaGastoFixo.count({ where: { subscriberId: { not: null } } }),
    gastos_fixos: await p.gastoFixo.count(),
    dividas: await p.divida.count(),
    plans: await p.plan.count(),
    goals: await p.goal.count(),
    check_ins: await p.checkIn.count(),
    catalogo: await p.categoriaGastoFixo.count({ where: { subscriberId: null } }),
  };
}

const UMA_CONTA_COMPLETA = {
  subscribers: 1,
  profiles: 1,
  categorias_gasto_fixo: 2,
  gastos_fixos: 2,
  dividas: 2,
  plans: 2,
  goals: 2,
  check_ins: 2,
};

const NENHUMA_LINHA = {
  subscribers: 0,
  profiles: 0,
  categorias_gasto_fixo: 0,
  gastos_fixos: 0,
  dividas: 0,
  plans: 0,
  goals: 0,
  check_ins: 0,
};

describe('ExcluirContaUseCase — só no Postgres', () => {
  beforeEach(async () => {
    await db.reset();
  });

  it('por tabela: zero linhas da pessoa, as da outra intactas, nenhuma órfã e o catálogo com as 24 categorias', async () => {
    const m = montar();
    const ana = await criarContaCompleta(m, ANA);
    const bruno = await criarContaCompleta(m, BRUNO);
    expect(await linhasDa(ana.subscriberId)).toEqual(UMA_CONTA_COMPLETA);
    expect(await linhasDa(bruno.subscriberId)).toEqual(UMA_CONTA_COMPLETA);

    await m.excluir.execute({ subscriberId: ana.subscriberId, confirmacao: CONFIRMACAO_EXCLUSAO });

    expect(await linhasDa(ana.subscriberId)).toEqual(NENHUMA_LINHA);
    expect(await linhasDa(bruno.subscriberId)).toEqual(UMA_CONTA_COMPLETA);
    // o banco inteiro tem só o que é do Bruno, mais o catálogo: nada da Ana ficou pendurado em outro dono
    expect(await linhasNoBanco()).toEqual({ ...UMA_CONTA_COMPLETA, catalogo: 24 });
  });

  it('erro no último passo desfaz a transação inteira: nada é apagado, e a exclusão seguinte funciona', async () => {
    class SubscribersQueFalhamAoApagar extends PrismaSubscribersRepository {
      override async delete(): Promise<void> {
        throw new Error('falha simulada ao apagar o subscriber, depois de todos os outros módulos');
      }
    }
    const comFalha = montar((database) => new SubscribersQueFalhamAoApagar(database));
    const ana = await criarContaCompleta(comFalha, ANA);

    await expect(
      comFalha.excluir.execute({ subscriberId: ana.subscriberId, confirmacao: CONFIRMACAO_EXCLUSAO }),
    ).rejects.toThrow('falha simulada');

    // gastos, dívidas, perfil, categorias, planos, metas e check-ins tinham sido apagados dentro da transação
    expect(await linhasDa(ana.subscriberId)).toEqual(UMA_CONTA_COMPLETA);
    expect(await retratoDa(comFalha, ana.subscriberId)).toEqual(CONTA_COMPLETA);

    // a transação não ficou presa: a mesma exclusão, sem a falha, apaga tudo
    await montar().excluir.execute({ subscriberId: ana.subscriberId, confirmacao: CONFIRMACAO_EXCLUSAO });
    expect(await linhasDa(ana.subscriberId)).toEqual(NENHUMA_LINHA);
  });
});
