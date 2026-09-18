import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeCursor } from '../../../../shared/application/pagination';
import { gerarPlano } from '../../../../shared/motor/motor';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { VersaoPlano, type PerfilDoMotor } from '../../../planos';
import { InMemoryVersoesPlanoRepository } from '../../../planos/infra';
import { CheckIn } from '../../domain/check-in';
import { createCheckInsModule } from '../../infra';
import { InMemoryCheckInsRepository } from '../database/in-memory-check-ins-repository';

/** CLT de 24 anos, aluguel, cartão rodando. */
const ANA: PerfilDoMotor = {
  rendaMensal: 3200,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1100,
  gastosFixos: [{ categoria: 'mercado', valor: 650 }],
  dividas: [{ tipo: 'rotativo', saldo: 1800, parcela: 150 }],
  guardado: 400,
};

/** Gasta mais do que ganha: plano em modo corte, aporte 0. */
const EM_CORTE: PerfilDoMotor = {
  rendaMensal: 1900,
  tipoRenda: 'informal',
  idade: 19,
  moradia: 'dividido',
  custoMoradia: 1200,
  gastosFixos: [{ categoria: 'combustivel', valor: 700 }],
  dividas: [],
  guardado: 0,
};

const MINUTO = 60_000;
/** o relógio do kit: 17 de setembro de 2026 */
const AGORA = '2026-09-17T12:00:00.000Z';

let kit: TestKit;
let app: ReturnType<TestKit['app']>;
let checkIns: InMemoryCheckInsRepository;
let versoesPlano: InMemoryVersoesPlanoRepository;

beforeEach(() => {
  kit = createTestKit();
  checkIns = new InMemoryCheckInsRepository();
  versoesPlano = new InMemoryVersoesPlanoRepository();
  app = kit.app((api) => api.use(createCheckInsModule({ ...kit.deps, checkIns, versoesPlano }).router));
});

// cada teste com o seu kit: um 500 escondido falha o próprio teste que o causou
afterEach(() => {
  expect(kit.unexpectedErrors).toEqual([]);
});

const responder = (subscriberId: string, competencia: string, corpo: unknown) =>
  request(app)
    .put(`/api/v1/check-ins/${competencia}`)
    .set('Authorization', kit.bearer(subscriberId))
    .send(corpo as object);

const obter = (subscriberId: string, competencia: string) =>
  request(app).get(`/api/v1/check-ins/${competencia}`).set('Authorization', kit.bearer(subscriberId));

const listar = (subscriberId: string, query: Record<string, string | number> = {}) =>
  request(app).get('/api/v1/check-ins').query(query).set('Authorization', kit.bearer(subscriberId));

/** o que o job do dia 1 faz: abre o mês e, se `enviadoEm`, reserva o envio */
async function abrirPeloJob(subscriberId: string, competencia: string, enviadoEm?: Date): Promise<CheckIn> {
  const checkIn = CheckIn.abrir({ id: `job-${subscriberId}-${competencia}`, subscriberId, competencia, agora: kit.clock.now() });
  await checkIns.save(checkIn);
  if (enviadoEm) await checkIns.claimSend(checkIn.id, enviadoEm);
  return checkIn;
}

async function salvarPlano(
  subscriberId: string,
  versao: number,
  perfil: PerfilDoMotor,
  ajuste: { aporte?: number; livre?: number } = {},
  // a data importa: a comparação usa a versão que valia no mês do check-in
  criadoEm: Date = kit.clock.now(),
) {
  await versoesPlano.save(
    VersaoPlano.criar({
      id: `plano-${subscriberId}-${versao}`,
      subscriberId,
      versao,
      inputSnap: perfil,
      resultado: { ...gerarPlano(structuredClone(perfil)), ...ajuste },
      criadoEm,
    }),
  );
}

describe('PUT /api/v1/check-ins/:competencia', () => {
  it('200: abre o mês, responde e compara com a versão do plano que valia no mês', async () => {
    // as duas nasceram dentro de setembro; a que vale pro mês é a mais nova
    await salvarPlano('sub-1', 1, ANA, { aporte: 100, livre: 50 }, new Date('2026-09-02T12:00:00.000Z'));
    await salvarPlano('sub-1', 2, ANA, { aporte: 500.3, livre: 300.2 });

    const res = await responder('sub-1', '2026-09', { rendaReal: 3200, gastoReal: 2400.5, guardadoReal: 799.5 }).expect(200);
    expect(res.body).toEqual({
      competencia: '2026-09',
      rendaReal: 3200,
      gastoReal: 2400.5,
      guardadoReal: 799.5,
      respondidoEm: AGORA,
      enviadoEm: null,
      comparacao: {
        aportePlanejado: 500.3,
        livrePlanejado: 300.2,
        guardadoReal: 799.5,
        diferenca: 299.2,
        cumpriu: true,
        versaoDoPlano: 2,
      },
    });
  });

  it('responder de novo corrige a resposta; sem plano, comparacao é null', async () => {
    await responder('sub-1', '2026-09', { rendaReal: 3200, gastoReal: 3000, guardadoReal: 200 }).expect(200);
    kit.clock.advance(90 * MINUTO);

    const res = await responder('sub-1', '2026-09', { rendaReal: 3250.1, gastoReal: 2900, guardadoReal: 19.99 }).expect(200);
    expect(res.body).toMatchObject({
      rendaReal: 3250.1,
      gastoReal: 2900,
      guardadoReal: 19.99,
      respondidoEm: '2026-09-17T13:30:00.000Z',
      comparacao: null,
    });
    const lista = await listar('sub-1').expect(200);
    expect(lista.body.items).toHaveLength(1);
  });

  it('responde o mês que o job abriu e enviou, mantendo a data do envio', async () => {
    const enviadoEm = new Date('2026-09-01T03:30:00.000Z');
    await abrirPeloJob('sub-1', '2026-08', enviadoEm);

    const res = await responder('sub-1', '2026-08', { rendaReal: 0, gastoReal: 0, guardadoReal: 0 }).expect(200);
    expect(res.body).toMatchObject({ rendaReal: 0, gastoReal: 0, guardadoReal: 0, enviadoEm: enviadoEm.toISOString(), respondidoEm: AGORA });
  });

  it('guardou menos que o plano: diferença negativa em centavos e não cumpriu', async () => {
    await salvarPlano('sub-1', 1, ANA, { aporte: 500.3 });
    const res = await responder('sub-1', '2026-09', { rendaReal: 3200, gastoReal: 2699.9, guardadoReal: 500.1 }).expect(200);
    expect(res.body.comparacao).toMatchObject({ diferenca: -0.2, cumpriu: false });
  });

  it('modo corte: aporte planejado 0 e qualquer valor guardado cumpre', async () => {
    await salvarPlano('sub-1', 1, EM_CORTE);
    const res = await responder('sub-1', '2026-09', { rendaReal: 1900, gastoReal: 1950, guardadoReal: 0 }).expect(200);
    expect(res.body.comparacao).toEqual({
      aportePlanejado: 0,
      livrePlanejado: 0,
      guardadoReal: 0,
      diferenca: 0,
      cumpriu: true,
      versaoDoPlano: 1,
    });
  });

  it('não expõe dono, id nem criadoEm; dono e id forjados no corpo são ignorados', async () => {
    const res = await responder('sub-1', '2026-09', {
      rendaReal: 10,
      gastoReal: 5,
      guardadoReal: 5,
      subscriberId: 'sub-2',
      id: 'forjado',
      enviadoEm: AGORA,
    }).expect(200);

    expect(Object.keys(res.body).sort()).toEqual([
      'comparacao',
      'competencia',
      'enviadoEm',
      'gastoReal',
      'guardadoReal',
      'rendaReal',
      'respondidoEm',
    ]);
    expect(res.body.enviadoEm).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('sub-1');
    await obter('sub-2', '2026-09').expect(404);
    expect((await checkIns.findByCompetencia('sub-1', '2026-09'))?.id).not.toBe('forjado');
  });

  it('o mesmo mês de outra pessoa não é alcançável: responder cria o seu e não toca no dela', async () => {
    await responder('sub-1', '2026-09', { rendaReal: 3200, gastoReal: 3000, guardadoReal: 200 }).expect(200);
    await responder('sub-2', '2026-09', { rendaReal: 1, gastoReal: 1, guardadoReal: 0 }).expect(200);

    const deSub1 = await obter('sub-1', '2026-09').expect(200);
    expect(deSub1.body).toMatchObject({ rendaReal: 3200, gastoReal: 3000, guardadoReal: 200 });
  });

  it('mês futuro → 400 com a mensagem da tela, e nada é gravado', async () => {
    const res = await responder('sub-1', '2026-10', { rendaReal: 1, gastoReal: 1, guardadoReal: 0 }).expect(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDACAO',
      message: 'Esse mês ainda não chegou',
      details: { competencia: 'Esse mês ainda não chegou' },
    });
    expect(await checkIns.findByCompetencia('sub-1', '2026-10')).toBeNull();
  });

  it.each(['2026-9', '2026-13', '2026-00', 'setembro', '1999-12', '2026-09-01'])('competência %j → 400', async (competencia) => {
    const res = await responder('sub-1', competencia, { rendaReal: 1, gastoReal: 1, guardadoReal: 0 }).expect(400);
    expect(res.body.error.details).toEqual({ competencia: 'Competência no formato AAAA-MM' });
  });

  it.each([
    [{ rendaReal: 3200, gastoReal: 3000 }, 'guardadoReal', 'Informe um valor em reais'],
    [{ rendaReal: -1, gastoReal: 0, guardadoReal: 0 }, 'rendaReal', 'Não pode ser negativo'],
    [{ rendaReal: 1, gastoReal: 10.005, guardadoReal: 0 }, 'gastoReal', 'No máximo 2 casas decimais'],
    [{ rendaReal: '3200', gastoReal: 0, guardadoReal: 0 }, 'rendaReal', 'Informe um valor em reais'],
    [{ rendaReal: 0, gastoReal: 0, guardadoReal: 10_000_000_000 }, 'guardadoReal', 'Confere esse valor? Está muito alto'],
  ])('corpo inválido %j → 400 no campo %s', async (corpo, campo, mensagem) => {
    const res = await responder('sub-1', '2026-09', corpo).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details[campo]).toBe(mensagem);
    expect(await checkIns.findByCompetencia('sub-1', '2026-09')).toBeNull();
  });

  it('JSON malformado → 400 JSON_INVALIDO', async () => {
    const res = await request(app)
      .put('/api/v1/check-ins/2026-09')
      .set('Authorization', kit.bearer('sub-1'))
      .set('Content-Type', 'application/json')
      .send('{"rendaReal":')
      .expect(400);
    expect(res.body.error.code).toBe('JSON_INVALIDO');
  });

  it('sem token → 401 no formato padrão; conta excluída → 401', async () => {
    const res = await request(app).put('/api/v1/check-ins/2026-09').send({ rendaReal: 1, gastoReal: 1, guardadoReal: 0 }).expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: 'Entre pra continuar.' });

    const bearer = kit.bearer('sub-1');
    kit.sessionAccounts.markDeleted('sub-1');
    await request(app)
      .put('/api/v1/check-ins/2026-09')
      .set('Authorization', bearer)
      .send({ rendaReal: 1, gastoReal: 1, guardadoReal: 0 })
      .expect(401);
    expect(await checkIns.findByCompetencia('sub-1', '2026-09')).toBeNull();
  });
});

describe('GET /api/v1/check-ins/:competencia', () => {
  it('200: mês aberto pelo job e ainda sem resposta vem com o planejado e o real em null', async () => {
    // plano gerado só em setembro: agosto cai no fallback e compara com a versão mais antiga
    await salvarPlano('sub-1', 1, ANA, { aporte: 400, livre: 250.5 });
    await abrirPeloJob('sub-1', '2026-08', new Date('2026-09-01T03:30:00.000Z'));

    const res = await obter('sub-1', '2026-08').expect(200);
    expect(res.body).toEqual({
      competencia: '2026-08',
      rendaReal: null,
      gastoReal: null,
      guardadoReal: null,
      respondidoEm: null,
      enviadoEm: '2026-09-01T03:30:00.000Z',
      comparacao: {
        aportePlanejado: 400,
        livrePlanejado: 250.5,
        guardadoReal: null,
        diferenca: null,
        cumpriu: null,
        versaoDoPlano: 1,
      },
    });
  });

  it('plano novo em setembro não muda o veredito de agosto: a mesma resposta byte a byte', async () => {
    await salvarPlano('sub-1', 1, ANA, { aporte: 400, livre: 200 }, new Date('2026-08-05T12:00:00.000Z'));
    await responder('sub-1', '2026-08', { rendaReal: 3200, gastoReal: 2800, guardadoReal: 400 }).expect(200);
    const antes = await obter('sub-1', '2026-08').expect(200);
    expect(antes.body.comparacao).toMatchObject({ aportePlanejado: 400, cumpriu: true, versaoDoPlano: 1 });

    // a pessoa troca o ritmo e o recálculo grava a versão 2
    await salvarPlano('sub-1', 2, ANA, { aporte: 900, livre: 100 });

    const depois = await obter('sub-1', '2026-08').expect(200);
    expect(depois.body).toEqual(antes.body);
  });

  it('200 com a resposta e a comparação', async () => {
    await salvarPlano('sub-1', 1, ANA, { aporte: 400, livre: 200 });
    await responder('sub-1', '2026-09', { rendaReal: 3000, gastoReal: 2650, guardadoReal: 350 }).expect(200);

    const res = await obter('sub-1', '2026-09').expect(200);
    expect(res.body).toMatchObject({
      guardadoReal: 350,
      comparacao: { diferenca: -50, cumpriu: false, versaoDoPlano: 1 },
    });
  });

  it('de outra pessoa ou inexistente → 404 com a mensagem da tela', async () => {
    await abrirPeloJob('sub-1', '2026-08');
    const deOutra = await obter('sub-2', '2026-08').expect(404);
    expect(deOutra.body.error).toMatchObject({ code: 'NAO_ENCONTRADO', message: 'Você ainda não tem check-in desse mês.' });
    await obter('sub-1', '2026-07').expect(404);
    // futuro não existe: 404, não 400
    await obter('sub-1', '2026-12').expect(404);
  });

  it.each(['2026-9', '2026-13', 'abc', '2101-01'])('competência %j → 400', async (competencia) => {
    const res = await obter('sub-1', competencia).expect(400);
    expect(res.body.error.details).toEqual({ competencia: 'Competência no formato AAAA-MM' });
  });

  it('sem token → 401', async () => {
    await abrirPeloJob('sub-1', '2026-08');
    await request(app).get('/api/v1/check-ins/2026-08').expect(401);
  });
});

describe('GET /api/v1/check-ins', () => {
  it('200 paginado do mês mais recente pro mais antigo', async () => {
    await abrirPeloJob('sub-1', '2026-07', new Date('2026-08-01T03:30:00.000Z'));
    await abrirPeloJob('sub-1', '2026-06');
    await abrirPeloJob('sub-1', '2026-08');
    await responder('sub-1', '2026-09', { rendaReal: 3200, gastoReal: 3000, guardadoReal: 200 }).expect(200);

    const p1 = await listar('sub-1', { limit: 2 }).expect(200);
    expect(p1.body.items).toEqual([
      { competencia: '2026-09', rendaReal: 3200, gastoReal: 3000, guardadoReal: 200, respondidoEm: AGORA, enviadoEm: null },
      { competencia: '2026-08', rendaReal: null, gastoReal: null, guardadoReal: null, respondidoEm: null, enviadoEm: null },
    ]);
    expect(p1.body.nextCursor).toEqual(expect.any(String));

    const p2 = await listar('sub-1', { limit: 2, cursor: p1.body.nextCursor }).expect(200);
    expect(p2.body).toEqual({
      items: [
        expect.objectContaining({ competencia: '2026-07', enviadoEm: '2026-08-01T03:30:00.000Z' }),
        expect.objectContaining({ competencia: '2026-06' }),
      ],
      nextCursor: null,
    });
  });

  it('a lista não traz comparação nem campo interno', async () => {
    await abrirPeloJob('sub-1', '2026-08');
    const res = await listar('sub-1').expect(200);
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'competencia',
      'enviadoEm',
      'gastoReal',
      'guardadoReal',
      'rendaReal',
      'respondidoEm',
    ]);
  });

  it('outra pessoa não vê os check-ins de ninguém', async () => {
    await abrirPeloJob('sub-1', '2026-08');
    const res = await listar('sub-2').expect(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    [{ limit: 0 }, 'limit'],
    [{ limit: 101 }, 'limit'],
    [{ limit: 'muitos' }, 'limit'],
    [{ cursor: 'lixo!!' }, 'cursor'],
    [{ cursor: encodeCursor('2026-13') }, 'cursor'],
  ])('query inválida %j → 400 com o campo', async (query, campo) => {
    const res = await listar('sub-1', query).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details).toHaveProperty(campo);
  });

  it('sem token → 401', async () => {
    await request(app).get('/api/v1/check-ins').expect(401);
  });

  it('nenhum erro inesperado (500) aconteceu nesses fluxos', () => {
    expect(kit.unexpectedErrors).toEqual([]);
  });
});
