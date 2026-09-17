import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { createCategoriasModule } from '../../infra';
import { InMemoryCategoriasRepository } from '../database/in-memory-categorias-repository';

let kit: TestKit;
let app: ReturnType<TestKit['app']>;
let emUso: Set<string>;

beforeEach(() => {
  kit = createTestKit();
  emUso = new Set();
  const categorias = new InMemoryCategoriasRepository({ withCatalog: true, isInUse: async (id) => emUso.has(id) });
  app = kit.app((api) => api.use(createCategoriasModule({ ...kit.deps, categorias }).router));
});

const criar = (subscriberId: string, nome: unknown) =>
  request(app).post('/api/v1/categorias').set('Authorization', kit.bearer(subscriberId)).send({ nome });

describe('GET /api/v1/categorias', () => {
  it('visitante recebe o catálogo com cache público', async () => {
    const res = await request(app).get('/api/v1/categorias').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    // mesma URL responde diferente com token: o cache precisa separar
    expect(res.headers.vary).toMatch(/\bauthorization\b/i);
    expect(res.body.items[0]).toEqual({
      id: 'categoria-aluguel',
      slug: 'aluguel',
      nome: 'Aluguel',
      grupo: 'moradia',
      icone: 'House',
      personalizada: false,
    });
  });

  it('autenticado recebe as próprias também, sem cache compartilhado', async () => {
    await criar('sub-1', 'Clube').expect(201);
    const res = await request(app).get('/api/v1/categorias').set('Authorization', kit.bearer('sub-1')).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.items.at(-1)).toMatchObject({ nome: 'Clube', personalizada: true, icone: 'Tag', slug: null });
  });

  it('conta excluída: a sessão deixa de valer, nas rotas públicas e nas privadas', async () => {
    const bearer = kit.bearer('sub-1');
    kit.sessionAccounts.markDeleted('sub-1');
    await request(app).get('/api/v1/categorias').set('Authorization', bearer).expect(401);
    await request(app).post('/api/v1/categorias').set('Authorization', bearer).send({ nome: 'X' }).expect(401);
  });

  it('token inválido não vira visitante em silêncio: 401', async () => {
    const res = await request(app).get('/api/v1/categorias').set('Authorization', 'Bearer lixo').expect(401);
    expect(res.body.error.code).toBe('NAO_AUTENTICADO');
  });
});

describe('POST /api/v1/categorias', () => {
  it('201 com Location e o corpo apresentado', async () => {
    const res = await criar('sub-1', ' Clube ').expect(201);
    expect(res.headers.location).toBe(`/api/v1/categorias/${res.body.id}`);
    expect(res.body).toMatchObject({ nome: 'Clube', grupo: 'outros', personalizada: true });
  });

  it('sem token → 401 no formato padrão, com requestId', async () => {
    const res = await request(app).post('/api/v1/categorias').send({ nome: 'X' }).expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: 'Entre pra continuar.' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('nome ausente → 400 com detalhe do campo', async () => {
    const res = await request(app)
      .post('/api/v1/categorias')
      .set('Authorization', kit.bearer('sub-1'))
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details).toHaveProperty('nome');
  });

  it('nome vazio (regra de domínio) → 400 com detalhe', async () => {
    const res = await criar('sub-1', '   ').expect(400);
    expect(res.body.error.details).toEqual({ nome: 'Dê um nome pra categoria' });
  });

  it('nome do catálogo → 409', async () => {
    const res = await criar('sub-1', 'Mercado').expect(409);
    expect(res.body.error.code).toBe('CONFLITO');
  });

  it('JSON malformado → 400 JSON_INVALIDO', async () => {
    const res = await request(app)
      .post('/api/v1/categorias')
      .set('Authorization', kit.bearer('sub-1'))
      .set('Content-Type', 'application/json')
      .send('{"nome":')
      .expect(400);
    expect(res.body.error.code).toBe('JSON_INVALIDO');
  });
});

describe('PATCH e DELETE /api/v1/categorias/:id', () => {
  it('renomeia (200) e exclui (204)', async () => {
    const { body } = await criar('sub-1', 'Clube').expect(201);
    await request(app)
      .patch(`/api/v1/categorias/${body.id}`)
      .set('Authorization', kit.bearer('sub-1'))
      .send({ nome: 'Clube novo' })
      .expect(200)
      .expect((res) => expect(res.body.nome).toBe('Clube novo'));
    await request(app).delete(`/api/v1/categorias/${body.id}`).set('Authorization', kit.bearer('sub-1')).expect(204);
  });

  it('categoria de outra pessoa → 404', async () => {
    const { body } = await criar('sub-1', 'Clube').expect(201);
    await request(app).delete(`/api/v1/categorias/${body.id}`).set('Authorization', kit.bearer('sub-2')).expect(404);
  });

  it('catálogo → 422; em uso → 409', async () => {
    await request(app)
      .patch('/api/v1/categorias/categoria-mercado')
      .set('Authorization', kit.bearer('sub-1'))
      .send({ nome: 'Super' })
      .expect(422);

    const { body } = await criar('sub-1', 'Clube').expect(201);
    emUso.add(body.id);
    await request(app).delete(`/api/v1/categorias/${body.id}`).set('Authorization', kit.bearer('sub-1')).expect(409);
  });

  it('nenhum erro inesperado (500) aconteceu nesses fluxos', () => {
    expect(kit.unexpectedErrors).toEqual([]);
  });
});
