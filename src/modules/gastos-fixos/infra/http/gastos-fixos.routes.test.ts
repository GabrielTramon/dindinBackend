import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { Categoria } from '../../../categorias';
import { InMemoryCategoriasRepository } from '../../../categorias/infra';
import type { PerfilGateway } from '../../application/ports';
import { createGastosFixosModule } from '../../infra';
import { InMemoryGastosFixosRepository } from '../database/in-memory-gastos-fixos-repository';

let kit: TestKit;
let app: ReturnType<TestKit['app']>;
let categorias: InMemoryCategoriasRepository;
let comPerfil: Set<string>;
// o kit é recriado a cada teste: os 500 de cada um ficam guardados aqui pro teste final do arquivo
const errosInesperados: unknown[] = [];

beforeEach(() => {
  kit = createTestKit();
  comPerfil = new Set(['sub-1', 'sub-2']);
  categorias = new InMemoryCategoriasRepository({ withCatalog: true });
  const perfilGateway: PerfilGateway = { exists: async (subscriberId) => comPerfil.has(subscriberId) };
  const gastosFixos = new InMemoryGastosFixosRepository({
    perfilExists: (subscriberId) => perfilGateway.exists(subscriberId),
    categoriaExists: async (categoriaId) => (await categorias.findById(categoriaId)) !== null,
  });
  app = kit.app((api) => api.use(createGastosFixosModule({ ...kit.deps, gastosFixos, categorias, perfilGateway }).router));
});

afterEach(() => {
  errosInesperados.push(...kit.unexpectedErrors);
});

const BASE = '/api/v1/perfil/gastos-fixos';
const MERCADO = InMemoryCategoriasRepository.catalogId('mercado');
const ALUGUEL = InMemoryCategoriasRepository.catalogId('aluguel');
const ID_LONGO_DEMAIS = 'x'.repeat(65);

let sequenciaPersonalizada = 0;

/** cria e grava uma categoria personalizada */
async function criarPersonalizada(subscriberId: string, nome: string): Promise<Categoria> {
  const categoria = Categoria.criarPersonalizada({
    id: `categoria-personalizada-${++sequenciaPersonalizada}`,
    nome,
    subscriberId,
    agora: kit.clock.now(),
  });
  await categorias.save(categoria);
  return categoria;
}

const listar = (subscriberId: string) => request(app).get(BASE).set('Authorization', kit.bearer(subscriberId));
const adicionar = (subscriberId: string, body: object) =>
  request(app).post(BASE).set('Authorization', kit.bearer(subscriberId)).send(body);
const alterar = (subscriberId: string, id: string, body: object) =>
  request(app).patch(`${BASE}/${id}`).set('Authorization', kit.bearer(subscriberId)).send(body);
const remover = (subscriberId: string, id: string) =>
  request(app).delete(`${BASE}/${id}`).set('Authorization', kit.bearer(subscriberId));

describe('GET /api/v1/perfil/gastos-fixos', () => {
  it('lista do maior pro menor, com a categoria inteira e o total em 2 casas, sem cache compartilhado', async () => {
    const clube = await criarPersonalizada('sub-1', 'Clube');
    await adicionar('sub-1', { categoriaId: clube.id, valor: 0.1 }).expect(201);
    await adicionar('sub-1', { categoriaId: MERCADO, valor: 0.2 }).expect(201);
    await adicionar('sub-1', { categoriaId: ALUGUEL, valor: 1200.5 }).expect(201);

    const res = await listar('sub-1').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const criadoEm = '2026-09-17T12:00:00.000Z';
    expect(res.body).toEqual({
      items: [
        {
          id: 'id-3',
          valor: 1200.5,
          criadoEm,
          categoria: { id: ALUGUEL, slug: 'aluguel', nome: 'Aluguel', grupo: 'moradia', icone: 'House', personalizada: false },
        },
        {
          id: 'id-2',
          valor: 0.2,
          criadoEm,
          categoria: { id: MERCADO, slug: 'mercado', nome: 'Mercado', grupo: 'casa', icone: 'ShoppingCart', personalizada: false },
        },
        {
          id: 'id-1',
          valor: 0.1,
          criadoEm,
          categoria: { id: clube.id, slug: null, nome: 'Clube', grupo: 'outros', icone: 'Tag', personalizada: true },
        },
      ],
      // 1200,5 + 0,2 + 0,1 em ponto flutuante não dá 1200,8 exato
      total: 1200.8,
    });
  });

  it('sem gastos → lista vazia e total 0', async () => {
    const res = await listar('sub-1').expect(200);
    expect(res.body).toEqual({ items: [], total: 0 });
  });

  it('gastos de outra pessoa não aparecem', async () => {
    await adicionar('sub-2', { categoriaId: MERCADO, valor: 700 }).expect(201);
    const res = await listar('sub-1').expect(200);
    expect(res.body).toEqual({ items: [], total: 0 });
  });

  it('sem token → 401', async () => {
    const res = await request(app).get(BASE).expect(401);
    expect(res.body.error.code).toBe('NAO_AUTENTICADO');
  });
});

describe('POST /api/v1/perfil/gastos-fixos', () => {
  it('201 com Location e o gasto apresentado, sem dono nem campo interno', async () => {
    const res = await adicionar('sub-1', { categoriaId: MERCADO, valor: 19.99 }).expect(201);
    expect(res.headers.location).toBe(`${BASE}/${res.body.id}`);
    expect(res.body).toEqual({
      id: 'id-1',
      valor: 19.99,
      criadoEm: '2026-09-17T12:00:00.000Z',
      categoria: { id: MERCADO, slug: 'mercado', nome: 'Mercado', grupo: 'casa', icone: 'ShoppingCart', personalizada: false },
    });
  });

  it('dono vem da sessão: subscriberId no corpo é ignorado', async () => {
    await adicionar('sub-1', { categoriaId: MERCADO, valor: 450, subscriberId: 'sub-2' }).expect(201);
    expect((await listar('sub-2').expect(200)).body.items).toEqual([]);
    expect((await listar('sub-1').expect(200)).body.items).toHaveLength(1);
  });

  it('sem token → 401', async () => {
    await request(app).post(BASE).send({ categoriaId: MERCADO, valor: 10 }).expect(401);
  });

  it('categoria personalizada de outra pessoa → 404, igual a inexistente', async () => {
    const deOutra = await criarPersonalizada('sub-2', 'Clube');
    const res = await adicionar('sub-1', { categoriaId: deOutra.id, valor: 10 }).expect(404);
    expect(res.body.error).toMatchObject({ code: 'NAO_ENCONTRADO', message: 'Categoria não encontrada.' });
    await adicionar('sub-1', { categoriaId: 'nao-existe', valor: 10 }).expect(404);
  });

  it.each([
    [{}, ['categoriaId', 'valor']],
    [{ categoriaId: MERCADO, valor: '10' }, ['valor']],
    [{ categoriaId: MERCADO, valor: -5 }, ['valor']],
    [{ categoriaId: '', valor: 10 }, ['categoriaId']],
    [{ categoriaId: ID_LONGO_DEMAIS, valor: 10 }, ['categoriaId']],
  ])('entrada inválida %j → 400 com detalhe dos campos', async (body, campos) => {
    const res = await adicionar('sub-1', body).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(Object.keys(res.body.error.details).sort()).toEqual(campos);
  });

  it('3 casas decimais → 400 com a mensagem pra tela', async () => {
    const res = await adicionar('sub-1', { categoriaId: MERCADO, valor: 10.005 }).expect(400);
    expect(res.body.error.details).toEqual({ valor: 'No máximo 2 casas decimais' });
  });

  it('acima do limite do onboarding (regra do domínio) → 400', async () => {
    const res = await adicionar('sub-1', { categoriaId: MERCADO, valor: 1_000_001 }).expect(400);
    expect(res.body.error.details).toEqual({ valor: 'Confere esse valor? Está muito alto' });
  });

  it('sem perfil → 422', async () => {
    comPerfil.delete('sub-1');
    const res = await adicionar('sub-1', { categoriaId: MERCADO, valor: 10 }).expect(422);
    expect(res.body.error).toMatchObject({ code: 'REGRA_DE_NEGOCIO', message: 'Crie seu perfil antes de adicionar gastos.' });
  });

  it('mesma categoria de novo → 409 com o nome da categoria', async () => {
    await adicionar('sub-1', { categoriaId: MERCADO, valor: 450 }).expect(201);
    const res = await adicionar('sub-1', { categoriaId: MERCADO, valor: 600 }).expect(409);
    expect(res.body.error).toMatchObject({
      code: 'CONFLITO',
      message: 'Você já tem um gasto em Mercado. Altere o valor dele.',
      details: { categoriaId: 'Você já tem um gasto nessa categoria' },
    });
  });
});

describe('PATCH /api/v1/perfil/gastos-fixos/:id', () => {
  it('200 altera o valor e devolve o gasto apresentado', async () => {
    const { body } = await adicionar('sub-1', { categoriaId: MERCADO, valor: 450 }).expect(201);
    const res = await alterar('sub-1', body.id, { valor: 479.9 }).expect(200);
    expect(res.body).toEqual({ ...body, valor: 479.9 });
    expect((await listar('sub-1').expect(200)).body.total).toBe(479.9);
  });

  it('sem token → 401', async () => {
    const { body } = await adicionar('sub-1', { categoriaId: MERCADO, valor: 450 }).expect(201);
    await request(app).patch(`${BASE}/${body.id}`).send({ valor: 1 }).expect(401);
  });

  it('gasto de outra pessoa → 404 e o valor não muda; inexistente → 404', async () => {
    const { body } = await adicionar('sub-1', { categoriaId: MERCADO, valor: 450 }).expect(201);
    const res = await alterar('sub-2', body.id, { valor: 1 }).expect(404);
    expect(res.body.error.message).toBe('Gasto não encontrado.');
    await alterar('sub-1', 'nao-existe', { valor: 1 }).expect(404);
    expect((await listar('sub-1').expect(200)).body.items[0].valor).toBe(450);
  });

  it('valor inválido ou id malformado → 400', async () => {
    const { body } = await adicionar('sub-1', { categoriaId: MERCADO, valor: 450 }).expect(201);
    const res = await alterar('sub-1', body.id, { valor: 0 }).expect(400);
    expect(res.body.error.details).toEqual({ valor: 'O valor precisa ser maior que zero' });
    await alterar('sub-1', body.id, {}).expect(400);
    await alterar('sub-1', ID_LONGO_DEMAIS, { valor: 10 }).expect(400);
  });
});

describe('DELETE /api/v1/perfil/gastos-fixos/:id', () => {
  it('204 e o gasto some da lista; a categoria pode ser usada de novo', async () => {
    const { body } = await adicionar('sub-1', { categoriaId: MERCADO, valor: 450 }).expect(201);
    const res = await remover('sub-1', body.id).expect(204);
    expect(res.text).toBe('');
    expect((await listar('sub-1').expect(200)).body.items).toEqual([]);
    await adicionar('sub-1', { categoriaId: MERCADO, valor: 500 }).expect(201);
  });

  it('sem token → 401', async () => {
    const { body } = await adicionar('sub-1', { categoriaId: MERCADO, valor: 450 }).expect(201);
    await request(app).delete(`${BASE}/${body.id}`).expect(401);
  });

  it('gasto de outra pessoa → 404 e continua lá; remover de novo → 404', async () => {
    const { body } = await adicionar('sub-1', { categoriaId: MERCADO, valor: 450 }).expect(201);
    await remover('sub-2', body.id).expect(404);
    expect((await listar('sub-1').expect(200)).body.items).toHaveLength(1);

    await remover('sub-1', body.id).expect(204);
    await remover('sub-1', body.id).expect(404);
  });

  it('id malformado → 400', async () => {
    const res = await remover('sub-1', ID_LONGO_DEMAIS).expect(400);
    expect(res.body.error.details).toHaveProperty('id');
  });
});

describe('erros inesperados', () => {
  it('nenhum 500 aconteceu nos fluxos deste arquivo', () => {
    expect(errosInesperados).toEqual([]);
  });
});
