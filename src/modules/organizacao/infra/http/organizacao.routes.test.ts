import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_GRUPOS, MAX_ITENS_POR_GRUPO } from '../../../../shared/motor/config';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { createOrganizacaoModule, InMemoryGruposRepository } from '../../infra';

let kit: TestKit;
let app: ReturnType<TestKit['app']>;

beforeEach(() => {
  kit = createTestKit();
  const grupos = new InMemoryGruposRepository();
  app = kit.app((api) => api.use(createOrganizacaoModule({ ...kit.deps, grupos }).router));
});

const ler = (subscriberId: string) =>
  request(app).get('/api/v1/organizacao').set('Authorization', kit.bearer(subscriberId));

const gravar = (subscriberId: string, corpo: object) =>
  request(app).put('/api/v1/organizacao').set('Authorization', kit.bearer(subscriberId)).send(corpo);

const GUARDAR = { id: 'g-1', nome: 'Guardar', icone: 'PiggyBank', valor: 840, doSistema: true };
const INVESTIMENTO = {
  id: 'g-2',
  nome: 'Investimento',
  icone: 'TrendingUp',
  valor: 800,
  contaParaMeta: true,
  rendimentoMensal: 0.008,
  itens: [
    { id: 'i-1', nome: 'Viagem', valor: 300 },
    { id: 'i-2', nome: 'Presente', valor: 19.99 },
  ],
};

describe('GET /api/v1/organizacao', () => {
  it('sem token → 401 no formato padrão, com requestId', async () => {
    const res = await request(app).get('/api/v1/organizacao').expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: 'Entre pra continuar.' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('quem nunca organizou nada recebe a árvore vazia (200), sem cache', async () => {
    const res = await ler('sub-1').expect(200);
    expect(res.body).toEqual({ grupos: [] });
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('conta excluída: a sessão deixa de valer', async () => {
    const bearer = kit.bearer('sub-1');
    kit.sessionAccounts.markDeleted('sub-1');
    await request(app).get('/api/v1/organizacao').set('Authorization', bearer).expect(401);
    await request(app).put('/api/v1/organizacao').set('Authorization', bearer).send({ grupos: [] }).expect(401);
  });

  it('rota que não existe debaixo de /organizacao → 404', async () => {
    const res = await request(app)
      .delete('/api/v1/organizacao/g-1')
      .set('Authorization', kit.bearer('sub-1'))
      .expect(404);
    expect(res.body.error.code).toBe('ROTA_NAO_ENCONTRADA');
  });
});

describe('PUT /api/v1/organizacao', () => {
  it('200 com a árvore, e o GET devolve exatamente o que foi gravado', async () => {
    const corpo = { grupos: [GUARDAR, INVESTIMENTO] };
    const res = await gravar('sub-1', corpo).expect(200);

    expect(res.body).toEqual({
      grupos: [
        { ...GUARDAR, contaParaMeta: false, itens: [] },
        { ...INVESTIMENTO, doSistema: false },
      ],
    });
    // o corpo da resposta é o corpo do próximo PUT: regravar não muda nada
    const lido = await ler('sub-1').expect(200);
    expect(lido.body).toEqual(res.body);
  });

  it('grupo sem rendimento volta SEM a chave — nunca `rendimentoMensal: null`', async () => {
    const res = await gravar('sub-1', { grupos: [{ id: 'g-1', nome: 'Namoro', valor: 100 }] }).expect(200);
    expect(res.body.grupos[0]).not.toHaveProperty('rendimentoMensal');
    expect(res.body.grupos[0]).toMatchObject({ icone: 'Tag', contaParaMeta: false, doSistema: false, itens: [] });
  });

  it('null no rendimento é "não rende", não erro', async () => {
    const res = await gravar('sub-1', {
      grupos: [{ id: 'g-1', nome: 'Namoro', valor: 100, rendimentoMensal: null }],
    }).expect(200);
    expect(res.body.grupos[0]).not.toHaveProperty('rendimentoMensal');
  });

  it('a ordem é posicional e sobrevive ao round-trip', async () => {
    await gravar('sub-1', {
      grupos: [
        { id: 'g-1', nome: 'Zebra', valor: 10 },
        { id: 'g-2', nome: 'Abacate', valor: 10 },
      ],
    }).expect(200);

    const res = await ler('sub-1').expect(200);
    expect(res.body.grupos.map((g: { nome: string }) => g.nome)).toEqual(['Zebra', 'Abacate']);
    // e a posição não vaza como campo: quem lê a lista já lê a ordem
    expect(res.body.grupos[0]).not.toHaveProperty('ordem');
    expect(res.body.grupos[0]).not.toHaveProperty('subscriberId');
  });

  it('substitui a árvore inteira; lista vazia limpa tudo', async () => {
    await gravar('sub-1', { grupos: [GUARDAR, INVESTIMENTO] }).expect(200);
    await gravar('sub-1', { grupos: [GUARDAR] }).expect(200);
    expect((await ler('sub-1')).body.grupos.map((g: { id: string }) => g.id)).toEqual(['g-1']);

    await gravar('sub-1', { grupos: [] }).expect(200);
    expect((await ler('sub-1')).body).toEqual({ grupos: [] });
  });

  it('a árvore de outra pessoa é invisível, mesmo com os mesmos ids', async () => {
    await gravar('sub-1', { grupos: [{ id: 'g-1', nome: 'Da 1', valor: 10 }] }).expect(200);
    expect((await ler('sub-2')).body).toEqual({ grupos: [] });

    await gravar('sub-2', { grupos: [{ id: 'g-1', nome: 'Da 2', valor: 20 }] }).expect(200);
    expect((await ler('sub-1')).body.grupos[0]).toMatchObject({ nome: 'Da 1', valor: 10 });
  });

  it('sem token → 401', async () => {
    await request(app).put('/api/v1/organizacao').send({ grupos: [] }).expect(401);
  });

  it('corpo sem grupos → 400 com detalhe do campo', async () => {
    const res = await gravar('sub-1', {}).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details).toHaveProperty('grupos');
  });

  it(`acima de ${MAX_GRUPOS} grupos → 400`, async () => {
    const grupos = Array.from({ length: MAX_GRUPOS + 1 }, (_, i) => ({ id: `g-${i}`, nome: 'Grupo', valor: 10 }));
    const res = await gravar('sub-1', { grupos }).expect(400);
    expect(res.body.error.details.grupos).toContain(`No máximo ${MAX_GRUPOS} grupos`);
  });

  it(`acima de ${MAX_ITENS_POR_GRUPO} itens num grupo → 400`, async () => {
    const itens = Array.from({ length: MAX_ITENS_POR_GRUPO + 1 }, (_, i) => ({ id: `i-${i}`, nome: 'Item', valor: 1 }));
    const res = await gravar('sub-1', { grupos: [{ id: 'g-1', nome: 'Grupo', valor: 100, itens }] }).expect(400);
    expect(res.body.error.details['grupos.0.itens']).toContain(`No máximo ${MAX_ITENS_POR_GRUPO} itens`);
  });

  it('nome acima de 40 caracteres → 400', async () => {
    const res = await gravar('sub-1', { grupos: [{ id: 'g-1', nome: 'x'.repeat(41), valor: 10 }] }).expect(400);
    expect(res.body.error.details['grupos.0.nome']).toBe('No máximo 40 caracteres');
  });

  it('centavo quebrado no valor → 400 apontando a linha', async () => {
    const res = await gravar('sub-1', {
      grupos: [{ id: 'g-1', nome: 'Grupo', valor: 10, itens: [{ id: 'i-1', nome: 'Item', valor: 1.005 }] }],
    }).expect(400);
    expect(res.body.error.details['grupos.0.itens.0.valor']).toBe('No máximo 2 casas decimais');
  });

  it('rendimento fora da faixa → 400 (8% a.m. é dedo a mais no teclado)', async () => {
    const res = await gravar('sub-1', {
      grupos: [{ id: 'g-1', nome: 'Grupo', valor: 10, rendimentoMensal: 0.08 }],
    }).expect(400);
    expect(res.body.error.details['grupos.0.rendimentoMensal']).toContain('5%');
  });

  it('dois grupos com o mesmo id → 400, não "o último vence"', async () => {
    const res = await gravar('sub-1', {
      grupos: [
        { id: 'g-1', nome: 'Um', valor: 10 },
        { id: 'g-1', nome: 'Outro', valor: 20 },
      ],
    }).expect(400);
    expect(res.body.error.details['grupos.1.id']).toBe('Esse grupo aparece duas vezes');
    expect((await ler('sub-1')).body).toEqual({ grupos: [] });
  });

  it('dois grupos do sistema → 400', async () => {
    const res = await gravar('sub-1', {
      grupos: [
        { id: 'g-1', nome: 'Guardar', valor: 10, doSistema: true },
        { id: 'g-2', nome: 'Guardar de novo', valor: 10, doSistema: true },
      ],
    }).expect(400);
    expect(res.body.error.details.grupos).toContain('grupo do sistema');
  });

  it('soma dos itens acima do valor do grupo → 400', async () => {
    const res = await gravar('sub-1', {
      grupos: [
        {
          id: 'g-1',
          nome: 'Grupo',
          valor: 100,
          itens: [
            { id: 'i-1', nome: 'Um', valor: 60 },
            { id: 'i-2', nome: 'Dois', valor: 60 },
          ],
        },
      ],
    }).expect(400);
    expect(res.body.error.details['grupos.0.itens']).toBe('A soma dos itens passou do valor do grupo');
  });

  it('a soma dos grupos acima da base NÃO é recusada: a base vem do plano, não do servidor', async () => {
    const grupos = Array.from({ length: MAX_GRUPOS }, (_, i) => ({ id: `g-${i}`, nome: 'Grupo', valor: 999_999 }));
    await gravar('sub-1', { grupos }).expect(200);
  });

  it('chave extra no corpo é descartada, nunca troca o dono', async () => {
    await gravar('sub-1', {
      grupos: [{ id: 'g-1', nome: 'Grupo', valor: 10, subscriberId: 'sub-2', ordem: 99, criadoEm: '1999-01-01' }],
    }).expect(200);

    expect((await ler('sub-2')).body).toEqual({ grupos: [] });
    expect((await ler('sub-1')).body.grupos[0]).toEqual({
      id: 'g-1',
      nome: 'Grupo',
      icone: 'Tag',
      valor: 10,
      contaParaMeta: false,
      doSistema: false,
      itens: [],
    });
  });

  it('JSON malformado → 400 JSON_INVALIDO', async () => {
    const res = await request(app)
      .put('/api/v1/organizacao')
      .set('Authorization', kit.bearer('sub-1'))
      .set('Content-Type', 'application/json')
      .send('{"grupos":')
      .expect(400);
    expect(res.body.error.code).toBe('JSON_INVALIDO');
  });

  it('nenhum erro inesperado (500) aconteceu nesses fluxos', () => {
    expect(kit.unexpectedErrors).toEqual([]);
  });
});
