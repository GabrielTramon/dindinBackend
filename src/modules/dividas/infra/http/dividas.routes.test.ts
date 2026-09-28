import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { MAX_DIVIDAS } from '../../domain/divida';
import { createDividasModule } from '../../infra';
import { InMemoryDividasRepository } from '../database/in-memory-dividas-repository';

let kit: TestKit;
let app: ReturnType<TestKit['app']>;
let perfis: Set<string>;

beforeEach(() => {
  kit = createTestKit();
  perfis = new Set(['sub-1', 'sub-2']);
  const perfilExists = async (id: string) => perfis.has(id);
  const dividas = new InMemoryDividasRepository({ perfilExists });
  app = kit.app((api) =>
    api.use(createDividasModule({ ...kit.deps, dividas, perfilGateway: { exists: perfilExists } }).router),
  );
});

const URL = '/api/v1/perfil/dividas';

// o kit é novo a cada teste: junta os 500 de todos pra conferir no fim do arquivo
const errosInesperados: unknown[] = [];
afterEach(() => {
  errosInesperados.push(...kit.unexpectedErrors);
});

const adicionar = (subscriberId: string, body: object) =>
  request(app).post(URL).set('Authorization', kit.bearer(subscriberId)).send(body);

const listar = (subscriberId: string) => request(app).get(URL).set('Authorization', kit.bearer(subscriberId));

const alterar = (subscriberId: string, id: string, body: object) =>
  request(app).patch(`${URL}/${id}`).set('Authorization', kit.bearer(subscriberId)).send(body);

const remover = (subscriberId: string, id: string) =>
  request(app).delete(`${URL}/${id}`).set('Authorization', kit.bearer(subscriberId));

describe('GET /api/v1/perfil/dividas', () => {
  it('lista na ordem de cadastro, com a taxa que o motor usa, a classe e os juros do mês', async () => {
    await adicionar('sub-1', { tipo: 'rotativo', saldo: 1000 }).expect(201);
    kit.clock.advance(1_000);
    await adicionar('sub-1', { tipo: 'financiamento', saldo: 20000, parcela: 850.5, taxaAnual: 0.1 }).expect(201);
    kit.clock.advance(1_000);
    await adicionar('sub-1', { tipo: 'emprestimo', saldo: 1500.1, taxaAnual: 0.2 }).expect(201);

    const res = await listar('sub-1').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    // o motor ordena da mais cara pra mais barata (rotativo, empréstimo, financiamento);
    // a API mantém a ordem de cadastro e cada avaliação fica na dívida certa
    expect(res.body).toEqual({
      items: [
        {
          id: 'id-1',
          tipo: 'rotativo',
          saldo: 1000,
          parcela: null,
          taxaAnual: null,
          taxaAnualUsada: 4.3,
          classe: 'cara',
          jurosMensais: 149.1,
          criadoEm: '2026-09-17T12:00:00.000Z',
        },
        {
          id: 'id-2',
          tipo: 'financiamento',
          saldo: 20000,
          parcela: 850.5,
          taxaAnual: 0.1,
          taxaAnualUsada: 0.1,
          classe: 'barata',
          jurosMensais: 159.48,
          criadoEm: '2026-09-17T12:00:01.000Z',
        },
        {
          id: 'id-3',
          tipo: 'emprestimo',
          saldo: 1500.1,
          parcela: null,
          taxaAnual: 0.2,
          taxaAnualUsada: 0.2,
          classe: 'media',
          jurosMensais: 22.97,
          criadoEm: '2026-09-17T12:00:02.000Z',
        },
      ],
    });
  });

  it('só as da própria pessoa; perfil sem dívidas recebe lista vazia', async () => {
    await adicionar('sub-1', { tipo: 'outra', saldo: 100 }).expect(201);
    const res = await listar('sub-2').expect(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('sem token → 401', async () => {
    const res = await request(app).get(URL).expect(401);
    expect(res.body.error.code).toBe('NAO_AUTENTICADO');
  });

  it('conta excluída: a sessão deixa de valer → 401', async () => {
    const bearer = kit.bearer('sub-1');
    kit.sessionAccounts.markDeleted('sub-1');
    await request(app).get(URL).set('Authorization', bearer).expect(401);
  });
});

describe('POST /api/v1/perfil/dividas', () => {
  it('201 com Location e o corpo apresentado, sem expor o dono', async () => {
    const res = await adicionar('sub-1', { tipo: 'cheque_especial', saldo: 800, parcela: 120.9, taxaAnual: 0.45 }).expect(
      201,
    );
    expect(res.headers.location).toBe(`${URL}/${res.body.id}`);
    expect(res.body).toEqual({
      id: 'id-1',
      tipo: 'cheque_especial',
      saldo: 800,
      parcela: 120.9,
      taxaAnual: 0.45,
      taxaAnualUsada: 0.45,
      classe: 'cara',
      jurosMensais: 25.16,
      criadoEm: '2026-09-17T12:00:00.000Z',
    });
  });

  it('parcela e taxa podem vir null (como o GET devolve); taxa null usa a padrão do tipo', async () => {
    const res = await adicionar('sub-1', { tipo: 'outra', saldo: 800, parcela: null, taxaAnual: null }).expect(201);
    expect(res.body).toMatchObject({
      parcela: null,
      taxaAnual: null,
      taxaAnualUsada: 0.4,
      classe: 'cara',
      jurosMensais: 22.75,
    });
  });

  it('o dono vem do token: subscriberId no corpo é ignorado', async () => {
    await adicionar('sub-1', { tipo: 'outra', saldo: 100, subscriberId: 'sub-2' }).expect(201);
    expect((await listar('sub-2').expect(200)).body.items).toEqual([]);
    expect((await listar('sub-1').expect(200)).body.items).toHaveLength(1);
  });

  it('sem token → 401 no formato padrão, com requestId', async () => {
    const res = await request(app).post(URL).send({ tipo: 'outra', saldo: 100 }).expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: 'Entre pra continuar.' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it.each([
    ['corpo vazio', {}, ['tipo', 'saldo']],
    ['tipo fora da lista (maiúsculo, como no banco)', { tipo: 'ROTATIVO', saldo: 100 }, ['tipo']],
    ['saldo como texto', { tipo: 'outra', saldo: '100' }, ['saldo']],
    ['saldo zero', { tipo: 'outra', saldo: 0 }, ['saldo']],
    ['saldo com 3 casas', { tipo: 'outra', saldo: 10.005 }, ['saldo']],
    ['parcela zero', { tipo: 'outra', saldo: 100, parcela: 0 }, ['parcela']],
    ['taxa acima de 20', { tipo: 'outra', saldo: 100, taxaAnual: 21 }, ['taxaAnual']],
    ['taxa negativa', { tipo: 'outra', saldo: 100, taxaAnual: -1 }, ['taxaAnual']],
  ])('%s → 400 com detalhe do campo', async (_caso, body, campos) => {
    const res = await adicionar('sub-1', body).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(Object.keys(res.body.error.details).sort()).toEqual([...campos].sort());
  });

  it('regra do domínio: taxa com 5 casas → 400 com a mensagem do campo', async () => {
    const res = await adicionar('sub-1', { tipo: 'outra', saldo: 100, taxaAnual: 0.12345 }).expect(400);
    expect(res.body.error.details).toEqual({ taxaAnual: 'No máximo 4 casas decimais' });
  });

  it('sem perfil → 422 com a orientação', async () => {
    perfis.delete('sub-1');
    const res = await adicionar('sub-1', { tipo: 'outra', saldo: 100 }).expect(422);
    expect(res.body.error).toMatchObject({
      code: 'REGRA_DE_NEGOCIO',
      message: 'Crie seu perfil antes de adicionar dívidas.',
    });
  });

  it(`no limite de ${MAX_DIVIDAS} dívidas → 422`, async () => {
    for (let i = 0; i < MAX_DIVIDAS; i++) await adicionar('sub-1', { tipo: 'outra', saldo: 100 }).expect(201);
    const res = await adicionar('sub-1', { tipo: 'outra', saldo: 100 }).expect(422);
    expect(res.body.error.message).toContain(`limite de ${MAX_DIVIDAS} dívidas`);
  });

  it('JSON malformado → 400 JSON_INVALIDO', async () => {
    const res = await request(app)
      .post(URL)
      .set('Authorization', kit.bearer('sub-1'))
      .set('Content-Type', 'application/json')
      .send('{"tipo":')
      .expect(400);
    expect(res.body.error.code).toBe('JSON_INVALIDO');
  });
});

describe('PATCH /api/v1/perfil/dividas/:id', () => {
  const criar = async () =>
    (await adicionar('sub-1', { tipo: 'emprestimo', saldo: 1000, parcela: 150, taxaAnual: 0.45 }).expect(201)).body as {
      id: string;
    };

  it('altera só o que veio (200) e reavalia com o motor', async () => {
    const { id } = await criar();
    const res = await alterar('sub-1', id, { saldo: 900.5, taxaAnual: 0.25 }).expect(200);
    expect(res.body).toMatchObject({
      id,
      tipo: 'emprestimo',
      saldo: 900.5,
      parcela: 150,
      taxaAnual: 0.25,
      taxaAnualUsada: 0.25,
      classe: 'media',
    });
  });

  it('null limpa parcela e taxa: a taxa usada volta a ser a padrão do tipo', async () => {
    const { id } = await criar();
    const res = await alterar('sub-1', id, { parcela: null, taxaAnual: null }).expect(200);
    expect(res.body).toMatchObject({ parcela: null, taxaAnual: null, taxaAnualUsada: 0.9, classe: 'cara' });
    expect((await listar('sub-1').expect(200)).body.items[0]).toMatchObject({ parcela: null, taxaAnual: null });
  });

  it('sem token → 401', async () => {
    const { id } = await criar();
    await request(app).patch(`${URL}/${id}`).send({ saldo: 1 }).expect(401);
  });

  it('dívida de outra pessoa → 404 e nada muda', async () => {
    const { id } = await criar();
    const res = await alterar('sub-2', id, { saldo: 1 }).expect(404);
    expect(res.body.error.code).toBe('NAO_ENCONTRADO');
    expect((await listar('sub-1').expect(200)).body.items[0].saldo).toBe(1000);
  });

  it('id inexistente → 404', async () => {
    await alterar('sub-1', 'nao-existe', { saldo: 1 }).expect(404);
  });

  it('corpo vazio → 400', async () => {
    const { id } = await criar();
    const res = await alterar('sub-1', id, {}).expect(400);
    expect(res.body.error.details).toEqual({ _: 'Informe pelo menos um campo pra alterar' });
  });

  it('só chaves desconhecidas conta como vazio → 400', async () => {
    const { id } = await criar();
    await alterar('sub-1', id, { subscriberId: 'sub-2' }).expect(400);
  });

  it.each([
    ['tipo inválido', { tipo: 'cartao' }, 'tipo'],
    ['saldo null (só parcela e taxa limpam)', { saldo: null }, 'saldo'],
    ['parcela como texto', { parcela: '10' }, 'parcela'],
    ['taxa acima de 20', { taxaAnual: 25 }, 'taxaAnual'],
  ])('%s → 400', async (_caso, body, campo) => {
    const { id } = await criar();
    const res = await alterar('sub-1', id, body).expect(400);
    expect(res.body.error.details).toHaveProperty(campo);
  });

  it('id longo demais → 400', async () => {
    await alterar('sub-1', 'x'.repeat(65), { saldo: 1 }).expect(400);
  });
});

describe('DELETE /api/v1/perfil/dividas/:id', () => {
  it('remove (204) e some da lista', async () => {
    const { body } = await adicionar('sub-1', { tipo: 'outra', saldo: 100 }).expect(201);
    const res = await remover('sub-1', body.id).expect(204);
    expect(res.text).toBe('');
    expect((await listar('sub-1').expect(200)).body.items).toEqual([]);
  });

  it('sem token → 401', async () => {
    const { body } = await adicionar('sub-1', { tipo: 'outra', saldo: 100 }).expect(201);
    await request(app).delete(`${URL}/${body.id}`).expect(401);
  });

  it('dívida de outra pessoa → 404 e continua lá', async () => {
    const { body } = await adicionar('sub-1', { tipo: 'outra', saldo: 100 }).expect(201);
    await remover('sub-2', body.id).expect(404);
    expect((await listar('sub-1').expect(200)).body.items).toHaveLength(1);
  });

  it('já removida ou inexistente → 404', async () => {
    const { body } = await adicionar('sub-1', { tipo: 'outra', saldo: 100 }).expect(201);
    await remover('sub-1', body.id).expect(204);
    await remover('sub-1', body.id).expect(404);
  });

  it('id longo demais → 400', async () => {
    await remover('sub-1', 'x'.repeat(65)).expect(400);
  });
});

it('nenhum erro inesperado (500) aconteceu em nenhum fluxo deste arquivo', () => {
  expect(errosInesperados).toEqual([]);
});
