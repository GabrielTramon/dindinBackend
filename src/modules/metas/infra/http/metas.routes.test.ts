import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aporteParaMeta } from '../../../../shared/motor/projecao';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { MAX_METAS, Meta } from '../../domain/meta';
import { createMetasModule } from '../../infra';
import { InMemoryMetasRepository } from '../database/in-memory-metas-repository';

let kit: TestKit;
let app: ReturnType<TestKit['app']>;
let metas: InMemoryMetasRepository;

beforeEach(() => {
  kit = createTestKit();
  metas = new InMemoryMetasRepository();
  app = kit.app((api) => api.use(createMetasModule({ ...kit.deps, metas }).router));
});

// cada teste tem o próprio kit: confere os 500 de cada um, não só os do último
afterEach(() => {
  expect(kit.unexpectedErrors).toEqual([]);
});

const ID_LONGO = 'x'.repeat(65);

const criar = (subscriberId: string, corpo: Record<string, unknown>) =>
  request(app).post('/api/v1/metas').set('Authorization', kit.bearer(subscriberId)).send(corpo);

const viagem = (subscriberId = 'sub-1') =>
  criar(subscriberId, { nome: 'Viagem pro Japão', valorAlvo: 12000, prazoMeses: 12, acumulado: 3000 }).expect(201);

const publicar = (subscriberId: string, id: string) =>
  request(app).post(`/api/v1/metas/${id}/publicar`).set('Authorization', kit.bearer(subscriberId));

describe('POST /api/v1/metas', () => {
  it('201 com Location e a meta apresentada, com projeção e sem dono', async () => {
    const res = await viagem();
    expect(res.headers.location).toBe(`/api/v1/metas/${res.body.id}`);
    expect(res.body).toEqual({
      id: 'id-1',
      nome: 'Viagem pro Japão',
      valorAlvo: 12000,
      aporteMensal: null,
      prazoMeses: 12,
      acumulado: 3000,
      progresso: 0.25,
      atingida: false,
      publicSlug: null,
      projecao: {
        faltante: 9000,
        aporteNecessario: aporteParaMeta(12000, 12, { saldoInicial: 3000 }),
        mesesEstimados: 12,
        mesEstimado: '2027-09',
      },
      criadoEm: '2026-09-17T12:00:00.000Z',
      atualizadoEm: '2026-09-17T12:00:00.000Z',
    });
  });

  it('meta por aporte: projeção em meses, aporte necessário null; centavos preservados', async () => {
    const res = await criar('sub-1', { nome: 'Carro', valorAlvo: 1000.5, aporteMensal: 250.25 }).expect(201);
    expect(res.body).toMatchObject({ aporteMensal: 250.25, prazoMeses: null, acumulado: 0 });
    expect(res.body.projecao).toMatchObject({ faltante: 1000.5, aporteNecessario: null });
    expect(res.body.projecao.mesesEstimados).toBeGreaterThan(0);
    expect(res.body.projecao.mesEstimado).toMatch(/^\d{4}-\d{2}$/);
  });

  it('dono vem do token: subscriberId e publicSlug no corpo são ignorados', async () => {
    const res = await criar('sub-1', {
      nome: 'Viagem',
      valorAlvo: 100,
      prazoMeses: 2,
      subscriberId: 'invasor',
      publicSlug: 'roubado-123456',
    }).expect(201);
    expect(res.body.publicSlug).toBeNull();
    expect(res.body).not.toHaveProperty('subscriberId');
    expect(await metas.findById(res.body.id, 'sub-1')).not.toBeNull();
  });

  it('sem token → 401', async () => {
    const res = await request(app).post('/api/v1/metas').send({ nome: 'X', valorAlvo: 1, prazoMeses: 1 }).expect(401);
    expect(res.body.error.code).toBe('NAO_AUTENTICADO');
  });

  it.each([
    [{ valorAlvo: 100, prazoMeses: 2 }, 'nome'],
    [{ nome: 'X', valorAlvo: 'mil', prazoMeses: 2 }, 'valorAlvo'],
    [{ nome: 'X', valorAlvo: 0, prazoMeses: 2 }, 'valorAlvo'],
    [{ nome: 'X', valorAlvo: 10.005, prazoMeses: 2 }, 'valorAlvo'],
    [{ nome: 'X', valorAlvo: 100, aporteMensal: -5 }, 'aporteMensal'],
    [{ nome: 'X', valorAlvo: 100, prazoMeses: 0 }, 'prazoMeses'],
    [{ nome: 'X', valorAlvo: 100, prazoMeses: 1201 }, 'prazoMeses'],
    [{ nome: 'X', valorAlvo: 100, prazoMeses: 1.5 }, 'prazoMeses'],
    [{ nome: 'X', valorAlvo: 100, prazoMeses: 2, acumulado: -1 }, 'acumulado'],
  ])('entrada inválida %j → 400 com detalhe em %s', async (corpo, campo) => {
    const res = await criar('sub-1', corpo).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details).toHaveProperty(campo);
  });

  it('nome em branco (regra do domínio) → 400 com detalhe', async () => {
    const res = await criar('sub-1', { nome: '   ', valorAlvo: 100, prazoMeses: 2 }).expect(400);
    expect(res.body.error.details).toEqual({ nome: 'Dê um nome pra meta' });
  });

  it('aporte e prazo juntos, ou nenhum → 422 com detalhe nos dois campos', async () => {
    for (const corpo of [
      { nome: 'X', valorAlvo: 100, aporteMensal: 10, prazoMeses: 10 },
      { nome: 'X', valorAlvo: 100 },
    ]) {
      const res = await criar('sub-1', corpo).expect(422);
      expect(res.body.error.code).toBe('REGRA_DE_NEGOCIO');
      expect(Object.keys(res.body.error.details).sort()).toEqual(['aporteMensal', 'prazoMeses']);
    }
  });

  it(`limite de ${MAX_METAS} metas → 422`, async () => {
    for (let i = 0; i < MAX_METAS; i++) {
      const dados = { id: `m${i}`, nome: `Meta ${i}`, valorAlvo: 100, prazoMeses: 1 };
      await metas.save(Meta.criar({ ...dados, subscriberId: 'sub-1', agora: kit.clock.now() }));
    }
    const res = await criar('sub-1', { nome: 'Mais uma', valorAlvo: 100, prazoMeses: 2 }).expect(422);
    expect(res.body.error.message).toContain(`limite de ${MAX_METAS} metas`);
    await criar('sub-2', { nome: 'De outra pessoa', valorAlvo: 100, prazoMeses: 2 }).expect(201);
  });
});

describe('GET /api/v1/metas', () => {
  it('lista só as da pessoa, da mais recente pra mais antiga', async () => {
    await criar('sub-1', { nome: 'Antiga', valorAlvo: 100, prazoMeses: 2 }).expect(201);
    kit.clock.advance(60_000);
    await criar('sub-1', { nome: 'Nova', valorAlvo: 100, aporteMensal: 10 }).expect(201);
    await viagem('sub-2');

    const res = await request(app).get('/api/v1/metas').set('Authorization', kit.bearer('sub-1')).expect(200);
    expect(res.body.items.map((m: { nome: string }) => m.nome)).toEqual(['Nova', 'Antiga']);
    expect(res.body.items[0]).not.toHaveProperty('subscriberId');
    expect(res.body.items[0].projecao).toBeDefined();
  });

  it('sem metas → items vazio', async () => {
    const res = await request(app).get('/api/v1/metas').set('Authorization', kit.bearer('sub-1')).expect(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('sem token → 401; conta excluída → 401', async () => {
    await request(app).get('/api/v1/metas').expect(401);
    const bearer = kit.bearer('sub-1');
    kit.sessionAccounts.markDeleted('sub-1');
    await request(app).get('/api/v1/metas').set('Authorization', bearer).expect(401);
  });
});

describe('GET /api/v1/metas/:id', () => {
  it('200 com a meta da pessoa', async () => {
    const { body } = await viagem();
    const res = await request(app).get(`/api/v1/metas/${body.id}`).set('Authorization', kit.bearer('sub-1')).expect(200);
    expect(res.body).toEqual(body);
  });

  it('de outra pessoa ou inexistente → 404', async () => {
    const { body } = await viagem();
    const res = await request(app).get(`/api/v1/metas/${body.id}`).set('Authorization', kit.bearer('sub-2')).expect(404);
    expect(res.body.error.code).toBe('NAO_ENCONTRADO');
    await request(app).get('/api/v1/metas/nao-existe').set('Authorization', kit.bearer('sub-1')).expect(404);
  });

  it('sem token → 401; id longo demais → 400', async () => {
    const { body } = await viagem();
    await request(app).get(`/api/v1/metas/${body.id}`).expect(401);
    const res = await request(app).get(`/api/v1/metas/${ID_LONGO}`).set('Authorization', kit.bearer('sub-1')).expect(400);
    expect(res.body.error.details).toHaveProperty('id');
  });
});

describe('PATCH /api/v1/metas/:id', () => {
  const patch = (subscriberId: string, id: string, corpo: unknown) =>
    request(app).patch(`/api/v1/metas/${id}`).set('Authorization', kit.bearer(subscriberId)).send(corpo as object);

  it('altera só o que veio e recalcula a projeção', async () => {
    const { body } = await viagem();
    kit.clock.advance(60_000);
    const res = await patch('sub-1', body.id, { acumulado: 12000 }).expect(200);
    expect(res.body).toMatchObject({
      nome: 'Viagem pro Japão',
      prazoMeses: 12,
      acumulado: 12000,
      progresso: 1,
      atingida: true,
      projecao: { faltante: 0, aporteNecessario: 0, mesesEstimados: 0, mesEstimado: '2026-09' },
      criadoEm: '2026-09-17T12:00:00.000Z',
      atualizadoEm: '2026-09-17T12:01:00.000Z',
    });
  });

  it('troca prazo por aporte mandando null no prazo', async () => {
    const { body } = await viagem();
    const res = await patch('sub-1', body.id, { aporteMensal: 500, prazoMeses: null }).expect(200);
    expect(res.body).toMatchObject({ aporteMensal: 500, prazoMeses: null, projecao: { aporteNecessario: null } });
  });

  it('aporte sem limpar o prazo → 422 e nada muda', async () => {
    const { body } = await viagem();
    await patch('sub-1', body.id, { aporteMensal: 500, nome: 'Outro' }).expect(422);
    const res = await request(app).get(`/api/v1/metas/${body.id}`).set('Authorization', kit.bearer('sub-1')).expect(200);
    expect(res.body).toMatchObject({ nome: 'Viagem pro Japão', aporteMensal: null, prazoMeses: 12 });
  });

  it.each([
    [{}, '_'],
    [{ subscriberId: 'invasor' }, '_'],
    [{ prazoMeses: 1201 }, 'prazoMeses'],
    [{ valorAlvo: null }, 'valorAlvo'],
    [{ acumulado: 1.001 }, 'acumulado'],
    [{ nome: 42 }, 'nome'],
  ])('entrada inválida %j → 400 com detalhe em %s', async (corpo, campo) => {
    const { body } = await viagem();
    const res = await patch('sub-1', body.id, corpo).expect(400);
    expect(res.body.error.details).toHaveProperty(campo);
  });

  it('de outra pessoa → 404 e nada muda; sem token → 401', async () => {
    const { body } = await viagem();
    await patch('sub-2', body.id, { nome: 'Invadida' }).expect(404);
    await request(app).patch(`/api/v1/metas/${body.id}`).send({ nome: 'Sem token' }).expect(401);
    expect((await metas.findById(body.id, 'sub-1'))?.nome).toBe('Viagem pro Japão');
  });
});

describe('DELETE /api/v1/metas/:id', () => {
  it('204 e a meta some', async () => {
    const { body } = await viagem();
    await request(app).delete(`/api/v1/metas/${body.id}`).set('Authorization', kit.bearer('sub-1')).expect(204);
    await request(app).get(`/api/v1/metas/${body.id}`).set('Authorization', kit.bearer('sub-1')).expect(404);
  });

  it('de outra pessoa → 404 e continua lá; sem token → 401; id longo → 400', async () => {
    const { body } = await viagem();
    await request(app).delete(`/api/v1/metas/${body.id}`).set('Authorization', kit.bearer('sub-2')).expect(404);
    await request(app).delete(`/api/v1/metas/${body.id}`).expect(401);
    await request(app).delete(`/api/v1/metas/${ID_LONGO}`).set('Authorization', kit.bearer('sub-1')).expect(400);
    expect(await metas.findById(body.id, 'sub-1')).not.toBeNull();
  });
});

describe('POST e DELETE /api/v1/metas/:id/publicar', () => {
  it('publica (200 com slug) e publicar de novo devolve o mesmo slug', async () => {
    const { body } = await viagem();
    const res = await publicar('sub-1', body.id).expect(200);
    expect(res.body.publicSlug).toMatch(/^viagem-pro-japao-[a-z0-9]{6}$/);
    expect(res.body).toMatchObject({ id: body.id, nome: 'Viagem pro Japão' });
    expect(res.body).not.toHaveProperty('subscriberId');

    const denovo = await publicar('sub-1', body.id).expect(200);
    expect(denovo.body.publicSlug).toBe(res.body.publicSlug);
  });

  it('despublica (200 com slug null) e o endereço deixa de responder', async () => {
    const { body } = await viagem();
    const { body: publicada } = await publicar('sub-1', body.id).expect(200);

    const res = await request(app)
      .delete(`/api/v1/metas/${body.id}/publicar`)
      .set('Authorization', kit.bearer('sub-1'))
      .expect(200);
    expect(res.body.publicSlug).toBeNull();
    await request(app).get(`/api/v1/metas/publicas/${publicada.publicSlug}`).expect(404);
  });

  it('despublicar meta privada → 200 sem mudar nada', async () => {
    const { body } = await viagem();
    kit.clock.advance(60_000);
    const res = await request(app)
      .delete(`/api/v1/metas/${body.id}/publicar`)
      .set('Authorization', kit.bearer('sub-1'))
      .expect(200);
    expect(res.body).toEqual(body);
  });

  it('de outra pessoa → 404; sem token → 401; id longo → 400', async () => {
    const { body } = await viagem();
    await publicar('sub-2', body.id).expect(404);
    await request(app).delete(`/api/v1/metas/${body.id}/publicar`).set('Authorization', kit.bearer('sub-2')).expect(404);
    await request(app).post(`/api/v1/metas/${body.id}/publicar`).expect(401);
    await request(app).delete(`/api/v1/metas/${body.id}/publicar`).expect(401);
    await publicar('sub-1', ID_LONGO).expect(400);
    await request(app).delete(`/api/v1/metas/${ID_LONGO}/publicar`).set('Authorization', kit.bearer('sub-1')).expect(400);
    expect((await metas.findById(body.id, 'sub-1'))?.publicSlug).toBeNull();
  });
});

describe('GET /api/v1/metas/publicas/:slug', () => {
  it('público: só nome, progresso e atingida, com cache compartilhado de 5 minutos', async () => {
    const { body } = await viagem();
    const { body: publicada } = await publicar('sub-1', body.id).expect(200);

    const res = await request(app).get(`/api/v1/metas/publicas/${publicada.publicSlug}`).expect(200);
    expect(res.body).toEqual({ nome: 'Viagem pro Japão', progresso: 0.25, atingida: false });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  it('não depende de token: com token vencido ou de outra pessoa responde igual', async () => {
    const { body } = await viagem();
    const { body: publicada } = await publicar('sub-1', body.id).expect(200);
    const url = `/api/v1/metas/publicas/${publicada.publicSlug}`;

    const anonimo = await request(app).get(url).expect(200);
    const comLixo = await request(app).get(url).set('Authorization', 'Bearer lixo').expect(200);
    const deOutra = await request(app).get(url).set('Authorization', kit.bearer('sub-2')).expect(200);
    expect(comLixo.body).toEqual(anonimo.body);
    expect(deOutra.body).toEqual(anonimo.body);
  });

  it('slug inexistente → 404, sem cache público', async () => {
    const res = await request(app).get('/api/v1/metas/publicas/nao-existe-abc123').expect(404);
    expect(res.body.error.code).toBe('NAO_ENCONTRADO');
    expect(res.headers['cache-control']).not.toBe('public, max-age=300');
  });

  it.each(['Viagem-ABC123', 'viagem_abc', 'a'.repeat(51), 'via%20gem'])('slug malformado %j → 400', async (slug) => {
    const res = await request(app).get(`/api/v1/metas/publicas/${slug}`).expect(400);
    expect(res.body.error.details).toHaveProperty('slug');
  });

  it('meta atingida aparece como atingida, sem valores', async () => {
    const { body } = await criar('sub-1', { nome: 'Reserva', valorAlvo: 500, acumulado: 500, prazoMeses: 6 }).expect(201);
    const { body: publicada } = await publicar('sub-1', body.id).expect(200);
    const res = await request(app).get(`/api/v1/metas/publicas/${publicada.publicSlug}`).expect(200);
    expect(res.body).toEqual({ nome: 'Reserva', progresso: 1, atingida: true });
  });
});

describe('fluxos sem erro inesperado', () => {
  it('nenhum erro inesperado (500) aconteceu nesses fluxos', () => {
    expect(kit.unexpectedErrors).toEqual([]);
  });
});
