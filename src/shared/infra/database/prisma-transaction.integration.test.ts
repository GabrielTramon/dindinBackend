import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../../test/test-database';
import { PrismaDatabase, PrismaTransactionManager } from './prisma';

/*
  A atomicidade que os casos de uso assumem: tudo que roda dentro de
  TransactionManager.run via `db.client` entra na mesma transação — sem
  nenhum repositório receber `tx` por parâmetro.
*/

let db: TestDatabase;
let database: PrismaDatabase;
let transactions: PrismaTransactionManager;

beforeAll(async () => {
  db = await startTestDatabase();
  database = new PrismaDatabase(db.prisma);
  transactions = new PrismaTransactionManager(database);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(() => db.reset());

const criar = (email: string) =>
  database.client.subscriber.create({ data: { email, token: `t:${email}` } });

const contar = () => db.prisma.subscriber.count();

describe('PrismaTransactionManager', () => {
  it('confirma tudo quando o trabalho termina', async () => {
    await transactions.run(async () => {
      await criar('a@x.dev');
      await criar('b@x.dev');
    });
    expect(await contar()).toBe(2);
  });

  it('desfaz tudo quando o trabalho lança — inclusive o que já tinha dado certo', async () => {
    await expect(
      transactions.run(async () => {
        await criar('a@x.dev');
        throw new Error('falhou no meio');
      }),
    ).rejects.toThrow('falhou no meio');
    expect(await contar()).toBe(0);
  });

  it('desfaz quando uma constraint falha no segundo passo', async () => {
    await expect(
      transactions.run(async () => {
        await criar('a@x.dev');
        await criar('a@x.dev'); // unique de e-mail
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await contar()).toBe(0);
  });

  it('run aninhado reaproveita a transação de fora: o rollback externo desfaz o interno', async () => {
    await expect(
      transactions.run(async () => {
        await transactions.run(async () => {
          await criar('interno@x.dev');
        });
        throw new Error('externo falhou depois');
      }),
    ).rejects.toThrow('externo falhou depois');
    expect(await contar()).toBe(0);
  });

  it('db.client dentro do run enxerga o que a própria transação escreveu', async () => {
    await transactions.run(async () => {
      await criar('a@x.dev');
      expect(await database.client.subscriber.count()).toBe(1);
    });
  });

  it('outra instância de PrismaDatabase sobre o mesmo cliente entra na mesma transação', async () => {
    const outra = new PrismaDatabase(db.prisma);
    await expect(
      transactions.run(async () => {
        await outra.client.subscriber.create({ data: { email: 'outra@x.dev', token: 't:outra' } });
        throw new Error('falhou no meio');
      }),
    ).rejects.toThrow('falhou no meio');
    expect(await contar()).toBe(0);
  });

  it('fora do run, db.client é o cliente raiz', async () => {
    expect(database.client).toBe(db.prisma);
  });

  it('timestamps gravados pelo banco saem em UTC (armadilha de fuso do PGlite)', async () => {
    const antes = Date.now();
    const s = await criar('fuso@x.dev');
    const depois = Date.now();
    // margem de 5 s: se o fuso vazasse, a diferença seria de horas
    expect(s.criadoEm.getTime()).toBeGreaterThanOrEqual(antes - 5_000);
    expect(s.criadoEm.getTime()).toBeLessThanOrEqual(depois + 5_000);
  });
});
