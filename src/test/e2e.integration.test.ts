import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executarFluxoCompleto, montarAmbiente, type AmbienteE2E } from './e2e-fluxo';
import { startTestDatabase, type TestDatabase } from './test-database';

/*
  Ponta a ponta com PERSISTENCIA=prisma: o container sobe o PrismaClient dele
  pela DATABASE_URL de um Postgres de verdade (PGlite servido por TCP), com as
  migrations aplicadas e o catálogo semeado. É o mesmo fluxo de e2e.test.ts —
  aqui ele passa pelas FKs reais, pela transação do PrismaTransactionManager
  (PUT /perfil/completo, DELETE /me), por Decimal e JSONB.

  O que este teste NÃO cobre: concorrência (o PGlite é uma sessão só) e
  diferenças do Postgres 16 de produção (o PGlite é 18). Ver test-database.ts.
*/

let db: TestDatabase;
let ambiente: AmbienteE2E;

beforeAll(async () => {
  db = await startTestDatabase();
  ambiente = montarAmbiente({ PERSISTENCIA: 'prisma', DATABASE_URL: db.url });
}, 60_000);

afterAll(async () => {
  // o pool do container antes do servidor: stop() não espera os sockets
  await ambiente?.container.close();
  await db?.close();
});

describe('e2e (Postgres)', () => {
  it('o fluxo completo, e no banco sobram só as linhas do Bruno e o catálogo', async () => {
    const { ana, bruno, passos } = await executarFluxoCompleto(ambiente);
    expect(passos).toHaveLength(21);

    const p = db.prisma;
    expect(await p.subscriber.findMany({ select: { id: true } })).toEqual([{ id: bruno.id }]);
    expect(await p.subscriber.count({ where: { OR: [{ id: ana.id }, { email: ana.email }] } })).toBe(0);

    const doBruno = { subscriberId: bruno.id };
    const deOutros = { subscriberId: { not: bruno.id } };
    expect({
      profiles: await p.profile.count({ where: doBruno }),
      gastosFixos: await p.gastoFixo.count({ where: { profileId: bruno.id } }),
      dividas: await p.divida.count({ where: { profileId: bruno.id } }),
      plans: await p.plan.count({ where: doBruno }),
      goals: await p.goal.count({ where: doBruno }),
      checkIns: await p.checkIn.count({ where: doBruno }),
    }).toEqual({ profiles: 1, gastosFixos: 2, dividas: 0, plans: 1, goals: 1, checkIns: 1 });

    expect({
      profiles: await p.profile.count({ where: deOutros }),
      gastosFixos: await p.gastoFixo.count({ where: { profileId: { not: bruno.id } } }),
      dividas: await p.divida.count(),
      plans: await p.plan.count({ where: deOutros }),
      goals: await p.goal.count({ where: deOutros }),
      checkIns: await p.checkIn.count({ where: deOutros }),
    }).toEqual({ profiles: 0, gastosFixos: 0, dividas: 0, plans: 0, goals: 0, checkIns: 0 });

    // as 24 do catálogo, e nenhuma personalizada (a "Clube" da Ana foi junto)
    expect(await p.categoriaGastoFixo.count()).toBe(24);
    expect(await p.categoriaGastoFixo.count({ where: { subscriberId: { not: null } } })).toBe(0);
    expect(await p.categoriaGastoFixo.count({ where: { slug: null } })).toBe(0);
  }, 120_000);
});
