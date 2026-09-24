import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { createCategoriasModule, InMemoryCategoriasRepository } from '../../../categorias/infra';
import { InMemoryDividasRepository } from '../../../dividas/infra';
import { InMemoryGastosFixosRepository } from '../../../gastos-fixos/infra';
import type { PerfilDoMotor } from '../../application/perfil-do-motor';
import { createPerfilModule } from '../../infra';
import { InMemoryPerfisRepository } from '../database/in-memory-perfis-repository';

let kit: TestKit;
let app: ReturnType<TestKit['app']>;

beforeEach(() => {
  kit = createTestKit();
  // ligados como o container liga: categoria em uso = tem gasto; gasto e dívida exigem perfil
  const perfis = new InMemoryPerfisRepository();
  const categorias = new InMemoryCategoriasRepository({
    withCatalog: true,
    isInUse: (id) => gastosFixos.existsForCategory(id),
  });
  const gastosFixos = new InMemoryGastosFixosRepository({
    perfilExists: (id) => perfis.exists(id),
    categoriaExists: async (id) => (await categorias.findById(id)) !== null,
  });
  const dividas = new InMemoryDividasRepository({ perfilExists: (id) => perfis.exists(id) });
  app = kit.app((api) => {
    api.use(createPerfilModule({ ...kit.deps, perfis, gastosFixos, dividas, categorias }).router);
    // pra criar personalizada "por fora", como o app faz
    api.use(createCategoriasModule({ ...kit.deps, categorias }).router);
  });
});

// o kit é novo a cada teste: junta os 500 de todos pra conferir no fim do arquivo
const errosInesperados: unknown[] = [];
afterEach(() => {
  errosInesperados.push(...kit.unexpectedErrors);
});

const ESCALARES = {
  rendaMensal: 2800.5,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1200,
  guardado: 1000,
} as const;

/** as respostas posteriores à v1: renda bruta, ritmo e meta */
const NOVOS = {
  rendaInformada: 'bruta',
  salarioBruto: 3500.75,
  dependentes: 2,
  competenciaTabela: '2026-01',
  ritmo: 'acelerado',
  meta: { tipo: 'outro', nome: 'Notebook novo', valorAlvo: 5400.99 },
} as const;

const COMPLETO: PerfilDoMotor = { ...ESCALARES, gastosFixos: [], dividas: [] };
const AGORA = '2026-09-17T12:00:00.000Z';

const obter = (sub: string) => request(app).get('/api/v1/perfil').set('Authorization', kit.bearer(sub));
const salvar = (sub: string, body: object) => request(app).put('/api/v1/perfil').set('Authorization', kit.bearer(sub)).send(body);
const atualizar = (sub: string, body: object) =>
  request(app).patch('/api/v1/perfil').set('Authorization', kit.bearer(sub)).send(body);
const obterCompleto = (sub: string) => request(app).get('/api/v1/perfil/completo').set('Authorization', kit.bearer(sub));
const sincronizar = (sub: string, body: object) =>
  request(app).put('/api/v1/perfil/completo').set('Authorization', kit.bearer(sub)).send(body);

describe('GET /api/v1/perfil', () => {
  it('200 com as respostas escalares, sem dono, sem cache compartilhado', async () => {
    await salvar('sub-1', ESCALARES).expect(201);
    const res = await obter('sub-1').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toEqual({ ...ESCALARES, atualizadoEm: AGORA });
  });

  it('sem perfil → 404 com a orientação', async () => {
    const res = await obter('sub-1').expect(404);
    expect(res.body.error).toMatchObject({ code: 'NAO_ENCONTRADO', message: 'Você ainda não respondeu o perfil.' });
  });

  it('o perfil de outra pessoa não aparece: 404', async () => {
    await salvar('sub-1', ESCALARES).expect(201);
    await obter('sub-2').expect(404);
  });

  it('sem token → 401; conta excluída → 401', async () => {
    const res = await request(app).get('/api/v1/perfil').expect(401);
    expect(res.body.error.code).toBe('NAO_AUTENTICADO');
    const bearer = kit.bearer('sub-1');
    kit.sessionAccounts.markDeleted('sub-1');
    await request(app).get('/api/v1/perfil').set('Authorization', bearer).expect(401);
  });
});

describe('PUT /api/v1/perfil', () => {
  it('sem perfil → 201 com Location; com perfil → 200 com as respostas novas', async () => {
    const criado = await salvar('sub-1', ESCALARES).expect(201);
    expect(criado.headers.location).toBe('/api/v1/perfil');
    expect(criado.body).toEqual({ ...ESCALARES, atualizadoEm: AGORA });

    kit.clock.advance(60_000);
    const atualizado = await salvar('sub-1', { ...ESCALARES, rendaMensal: 3100, tipoRenda: 'informal' }).expect(200);
    expect(atualizado.headers.location).toBeUndefined();
    expect(atualizado.body).toEqual({
      ...ESCALARES,
      rendaMensal: 3100,
      tipoRenda: 'informal',
      atualizadoEm: '2026-09-17T12:01:00.000Z',
    });
  });

  it('moradia sem custo (regra do domínio) zera o custo informado', async () => {
    const res = await salvar('sub-1', { ...ESCALARES, moradia: 'propria', custoMoradia: 800 }).expect(201);
    expect(res.body.custoMoradia).toBe(0);
  });

  it('o dono vem do token: subscriberId no corpo é ignorado', async () => {
    await salvar('sub-1', { ...ESCALARES, subscriberId: 'sub-2' }).expect(201);
    await obter('sub-2').expect(404);
    await obter('sub-1').expect(200);
  });

  it('sem token → 401', async () => {
    await request(app).put('/api/v1/perfil').send(ESCALARES).expect(401);
  });

  it('não mexe no perfil de outra pessoa: cada um grava o seu', async () => {
    await salvar('sub-1', ESCALARES).expect(201);
    await salvar('sub-2', { ...ESCALARES, idade: 50 }).expect(201);
    expect((await obter('sub-1').expect(200)).body.idade).toBe(24);
  });

  it.each([
    ['corpo vazio', {}, ['custoMoradia', 'guardado', 'idade', 'moradia', 'rendaMensal', 'tipoRenda']],
    ['tipo de renda maiúsculo, como no banco', { ...ESCALARES, tipoRenda: 'CLT' }, ['tipoRenda']],
    ['moradia fora da lista', { ...ESCALARES, moradia: 'barraca' }, ['moradia']],
    ['renda como texto', { ...ESCALARES, rendaMensal: '2800' }, ['rendaMensal']],
    ['renda zero', { ...ESCALARES, rendaMensal: 0 }, ['rendaMensal']],
    ['renda com 3 casas', { ...ESCALARES, rendaMensal: 2800.005 }, ['rendaMensal']],
    ['guardado negativo', { ...ESCALARES, guardado: -1 }, ['guardado']],
  ])('%s → 400 com detalhe dos campos', async (_caso, body, campos) => {
    const res = await salvar('sub-1', body).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(Object.keys(res.body.error.details).sort()).toEqual(campos);
  });

  it('idade fora da faixa do onboarding (regra do domínio) → 400 com a mensagem do frontend', async () => {
    const res = await salvar('sub-1', { ...ESCALARES, idade: 13 }).expect(400);
    expect(res.body.error.details).toEqual({ idade: 'A partir de 14 anos' });
    await obter('sub-1').expect(404);
  });
});

describe('PATCH /api/v1/perfil', () => {
  it('200 muda só o que veio', async () => {
    await salvar('sub-1', ESCALARES).expect(201);
    kit.clock.advance(1_000);
    const res = await atualizar('sub-1', { guardado: 1500.75 }).expect(200);
    expect(res.body).toEqual({ ...ESCALARES, guardado: 1500.75, atualizadoEm: '2026-09-17T12:00:01.000Z' });
    expect((await obter('sub-1').expect(200)).body.guardado).toBe(1500.75);
  });

  it('sem perfil, ou com o perfil só de outra pessoa → 404', async () => {
    await salvar('sub-1', ESCALARES).expect(201);
    const res = await atualizar('sub-2', { idade: 30 }).expect(404);
    expect(res.body.error.message).toBe('Você ainda não respondeu o perfil.');
    expect((await obter('sub-1').expect(200)).body.idade).toBe(24);
  });

  it('sem token → 401', async () => {
    await request(app).patch('/api/v1/perfil').send({ idade: 30 }).expect(401);
  });

  it('corpo vazio ou só com chave desconhecida → 400', async () => {
    await salvar('sub-1', ESCALARES).expect(201);
    const res = await atualizar('sub-1', {}).expect(400);
    expect(res.body.error.details).toEqual({ _: 'Informe pelo menos um campo pra alterar' });
    await atualizar('sub-1', { subscriberId: 'sub-2' }).expect(400);
  });

  it.each([
    ['tipo de renda inválido', { tipoRenda: 'autonomo' }, 'tipoRenda'],
    ['renda null', { rendaMensal: null }, 'rendaMensal'],
    ['custo com 3 casas', { custoMoradia: 10.001 }, 'custoMoradia'],
  ])('%s → 400', async (_caso, body, campo) => {
    await salvar('sub-1', ESCALARES).expect(201);
    const res = await atualizar('sub-1', body).expect(400);
    expect(res.body.error.details).toHaveProperty(campo);
  });

  it('sair de moradia sem custo sem informar o custo (regra do domínio) → 400 e nada muda', async () => {
    await salvar('sub-1', { ...ESCALARES, moradia: 'pais', custoMoradia: 0 }).expect(201);
    const res = await atualizar('sub-1', { moradia: 'aluguel' }).expect(400);
    expect(res.body.error.details).toEqual({ custoMoradia: 'Informe quanto sai de moradia' });
    expect((await obter('sub-1').expect(200)).body.moradia).toBe('pais');

    await atualizar('sub-1', { moradia: 'aluguel', custoMoradia: 1300 }).expect(200);
  });
});

describe('GET /api/v1/perfil/completo', () => {
  it('200 no formato do motor, sem cache compartilhado', async () => {
    await sincronizar('sub-1', {
      ...COMPLETO,
      gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 80 }],
      dividas: [{ tipo: 'rotativo', saldo: 1500 }],
    }).expect(200);

    const res = await obterCompleto('sub-1').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toEqual({
      ...COMPLETO,
      gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 80 }],
      dividas: [{ tipo: 'rotativo', saldo: 1500 }],
    });
  });

  it('perfil criado só com PUT /perfil vem com listas vazias', async () => {
    await salvar('sub-1', ESCALARES).expect(201);
    expect((await obterCompleto('sub-1').expect(200)).body).toEqual(COMPLETO);
  });

  it('sem perfil → 404; o de outra pessoa não conta', async () => {
    await obterCompleto('sub-1').expect(404);
    await sincronizar('sub-1', COMPLETO).expect(200);
    await obterCompleto('sub-2').expect(404);
  });

  it('sem token → 401', async () => {
    await request(app).get('/api/v1/perfil/completo').expect(401);
  });
});

describe('PUT /api/v1/perfil/completo', () => {
  it('200 devolve o que ficou gravado: linhas somadas, nome do catálogo virando slug, gastos do maior pro menor', async () => {
    const res = await sincronizar('sub-1', {
      ...COMPLETO,
      gastosFixos: [
        { categoria: 'outro', nome: 'Clube', valor: 50 },
        { categoria: 'outro', nome: 'Condomínio', valor: 300 },
        { categoria: 'outro', nome: 'clube', valor: 30.5 },
        { categoria: 'mercado', valor: 400 },
        { categoria: 'outro', nome: 'Mercado', valor: 50 },
      ],
      dividas: [{ tipo: 'emprestimo', saldo: 3000, parcela: 250, taxaAnual: 0.45 }],
    }).expect(200);

    expect(res.body).toEqual({
      ...COMPLETO,
      gastosFixos: [
        { categoria: 'mercado', valor: 450 },
        { categoria: 'condominio', valor: 300 },
        { categoria: 'outro', nome: 'Clube', valor: 80.5 },
      ],
      dividas: [{ tipo: 'emprestimo', saldo: 3000, parcela: 250, taxaAnual: 0.45 }],
    });
    expect((await obterCompleto('sub-1').expect(200)).body).toEqual(res.body);
    // os escalares também ficam disponíveis no GET /perfil
    expect((await obter('sub-1').expect(200)).body).toEqual({ ...ESCALARES, atualizadoEm: AGORA });
  });

  it('idempotente: o mesmo corpo duas vezes dá o mesmo GET', async () => {
    const corpo = {
      ...COMPLETO,
      gastosFixos: [
        { categoria: 'luz', valor: 100 },
        { categoria: 'outro', nome: 'Clube', valor: 100 },
      ],
      dividas: [
        { tipo: 'rotativo', saldo: 500 },
        { tipo: 'outra', saldo: 500 },
      ],
    };
    const primeiro = await sincronizar('sub-1', corpo).expect(200);
    const segundo = await sincronizar('sub-1', corpo).expect(200);
    expect(segundo.body).toEqual(primeiro.body);
    expect((await obterCompleto('sub-1').expect(200)).body).toEqual(primeiro.body);
  });

  it('renomear a personalizada troca a categoria; a criada por fora (POST /categorias) sem gasto continua', async () => {
    await request(app).post('/api/v1/categorias').set('Authorization', kit.bearer('sub-1')).send({ nome: 'Padaria' }).expect(201);
    await sincronizar('sub-1', { ...COMPLETO, gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 80 }] }).expect(200);
    await sincronizar('sub-1', { ...COMPLETO, gastosFixos: [{ categoria: 'outro', nome: 'Clube de tiro', valor: 80 }] }).expect(200);

    const res = await request(app).get('/api/v1/categorias').set('Authorization', kit.bearer('sub-1')).expect(200);
    const nomes = (res.body.items as { nome: string; personalizada: boolean }[]).filter((c) => c.personalizada).map((c) => c.nome);
    expect(nomes.sort()).toEqual(['Clube de tiro', 'Padaria']);
  });

  it('lista de dívidas vazia apaga as dívidas', async () => {
    await sincronizar('sub-1', { ...COMPLETO, dividas: [{ tipo: 'rotativo', saldo: 1500 }] }).expect(200);
    const res = await sincronizar('sub-1', { ...COMPLETO, dividas: [] }).expect(200);
    expect(res.body.dividas).toEqual([]);
    expect((await obterCompleto('sub-1').expect(200)).body.dividas).toEqual([]);
  });

  it('o dono vem do token, e o PUT de uma pessoa nunca mexe no perfil de outra', async () => {
    await sincronizar('sub-1', { ...COMPLETO, gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 80 }] }).expect(200);
    const deSub1 = (await obterCompleto('sub-1').expect(200)).body;

    await sincronizar('sub-2', { ...COMPLETO, idade: 50, subscriberId: 'sub-1', gastosFixos: [] }).expect(200);
    expect((await obterCompleto('sub-1').expect(200)).body).toEqual(deSub1);
    expect((await obterCompleto('sub-2').expect(200)).body.idade).toBe(50);
  });

  it('sem token → 401', async () => {
    const res = await request(app).put('/api/v1/perfil/completo').send(COMPLETO).expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: 'Entre pra continuar.' });
  });

  it.each([
    ['corpo vazio', {}, 'rendaMensal'],
    ['"outro" sem nome (schema do motor)', { ...COMPLETO, gastosFixos: [{ categoria: 'outro', valor: 10 }] }, 'gastosFixos.0.nome'],
    ['slug desconhecido', { ...COMPLETO, gastosFixos: [{ categoria: 'jatinho', valor: 10 }] }, 'gastosFixos.0.categoria'],
    ['valor zero', { ...COMPLETO, gastosFixos: [{ categoria: 'luz', valor: 0 }] }, 'gastosFixos.0.valor'],
    ['tipo de dívida maiúsculo', { ...COMPLETO, dividas: [{ tipo: 'ROTATIVO', saldo: 10 }] }, 'dividas.0.tipo'],
    ['mais de 20 gastos', { ...COMPLETO, gastosFixos: Array.from({ length: 21 }, () => ({ categoria: 'luz', valor: 1 })) }, 'gastosFixos'],
  ])('%s → 400 com o caminho do campo', async (_caso, body, caminho) => {
    const res = await sincronizar('sub-1', body).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details).toHaveProperty([caminho]);
  });

  it('parcela maior que o saldo → 400 no campo da parcela, e nada é gravado', async () => {
    const res = await sincronizar('sub-1', {
      ...COMPLETO,
      dividas: [{ tipo: 'rotativo', saldo: 900 }, { tipo: 'emprestimo', saldo: 1000, parcela: 5000 }],
    }).expect(400);
    expect(res.body.error.details).toEqual({
      'dividas.1.parcela': 'A parcela está maior que o total da dívida. Confere os dois valores?',
    });
    await obterCompleto('sub-1').expect(404);
  });

  it('valor com 3 casas numa linha (regra do domínio) → 400 no caminho da linha, e nada é gravado', async () => {
    const antes = { ...COMPLETO, gastosFixos: [{ categoria: 'luz', valor: 120 }], dividas: [{ tipo: 'rotativo', saldo: 900 }] };
    await sincronizar('sub-1', antes).expect(200);

    const res = await sincronizar('sub-1', {
      ...COMPLETO,
      idade: 60,
      gastosFixos: [
        { categoria: 'mercado', valor: 100 },
        { categoria: 'outro', nome: 'Clube', valor: 10.005 },
      ],
      dividas: [],
    }).expect(400);

    expect(res.body.error.details).toEqual({ 'gastosFixos.1.valor': 'No máximo 2 casas decimais' });
    expect((await obterCompleto('sub-1').expect(200)).body).toEqual(antes);
  });
});

/*
  A malha dos campos posteriores à v1 pelas quatro portas. Todos são opcionais:
  faltar na lista do schema faz o PUT responder 200 e IGNORAR a escolha; faltar
  no presenter faz o cliente regravar sem ela e a escolha sumir no F5. Nenhum
  dos dois quebra a compilação — só estes testes.
*/
describe('Perfil — renda bruta, ritmo e meta pelo HTTP', () => {
  it('PUT /perfil aceita e devolve os campos novos, e o GET traz os mesmos', async () => {
    const res = await salvar('sub-1', { ...ESCALARES, ...NOVOS }).expect(201);
    expect(res.body).toEqual({ ...ESCALARES, ...NOVOS, atualizadoEm: AGORA });
    expect((await obter('sub-1').expect(200)).body).toEqual(res.body);
  });

  it('PUT /perfil sem os campos novos não inventa chave nenhuma na resposta', async () => {
    const res = await salvar('sub-1', ESCALARES).expect(201);
    expect(Object.keys(res.body).sort()).toEqual([...Object.keys(ESCALARES), 'atualizadoEm'].sort());
  });

  it('PUT /perfil sem ritmo apaga o ritmo gravado: o PUT substitui todas as respostas', async () => {
    await salvar('sub-1', { ...ESCALARES, ...NOVOS }).expect(201);
    const res = await salvar('sub-1', ESCALARES).expect(200);
    expect(res.body).toEqual({ ...ESCALARES, atualizadoEm: AGORA });
    expect((await obter('sub-1').expect(200)).body.ritmo).toBeUndefined();
  });

  it('PATCH /perfil muda só o ritmo e mantém o resto', async () => {
    await salvar('sub-1', { ...ESCALARES, ...NOVOS }).expect(201);
    const res = await atualizar('sub-1', { ritmo: 'leve' }).expect(200);
    expect(res.body).toEqual({ ...ESCALARES, ...NOVOS, ritmo: 'leve', atualizadoEm: AGORA });
  });

  it('PUT /perfil/completo grava e devolve os campos novos, e o GET /completo repete', async () => {
    const corpo = { ...COMPLETO, ...NOVOS, gastosFixos: [{ categoria: 'luz', valor: 120 }] };
    const res = await sincronizar('sub-1', corpo).expect(200);

    expect(res.body).toEqual(corpo);
    expect((await obterCompleto('sub-1').expect(200)).body).toEqual(corpo);
    // e o ritmo escolhido aparece também na porta dos escalares
    expect((await obter('sub-1').expect(200)).body.ritmo).toBe('acelerado');
  });

  it('PUT /perfil/completo sem os campos novos devolve o corpo sem as chaves', async () => {
    const res = await sincronizar('sub-1', COMPLETO).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(Object.keys(COMPLETO).sort());
  });

  it.each([
    ['ritmo fora da lista', { ...ESCALARES, ritmo: 'agressivo' }, 'ritmo'],
    ['ritmo MAIÚSCULO, como no banco', { ...ESCALARES, ritmo: 'ACELERADO' }, 'ritmo'],
    ['renda informada fora da lista', { ...ESCALARES, rendaInformada: 'mista' }, 'rendaInformada'],
    ['salário bruto com 3 casas', { ...ESCALARES, rendaInformada: 'bruta', salarioBruto: 3500.005 }, 'salarioBruto'],
    ['competência fora do formato', { ...ESCALARES, competenciaTabela: '2026-13' }, 'competenciaTabela'],
    ['dependentes como texto', { ...ESCALARES, dependentes: 'dois' }, 'dependentes'],
    ['dependentes acima de 10 (regra do domínio)', { ...ESCALARES, dependentes: 11 }, 'dependentes'],
    ['meta "outro" sem nome (schema do motor)', { ...ESCALARES, meta: { tipo: 'outro', valorAlvo: 5000 } }, 'meta.nome'],
    ['meta com valor zero', { ...ESCALARES, meta: { tipo: 'carro', valorAlvo: 0 } }, 'meta.valorAlvo'],
    ['renda bruta sem o salário bruto (regra do domínio)', { ...ESCALARES, rendaInformada: 'bruta' }, 'salarioBruto'],
  ])('PUT /perfil com %s → 400 no campo', async (_caso, body, campo) => {
    const res = await salvar('sub-1', body).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details).toHaveProperty([campo]);
    await obter('sub-1').expect(404);
  });

  it('PUT /perfil/completo com meta "outro" sem nome → 400 no caminho do campo', async () => {
    const res = await sincronizar('sub-1', { ...COMPLETO, meta: { tipo: 'outro', valorAlvo: 5000 } }).expect(400);
    expect(res.body.error.details).toHaveProperty(['meta.nome']);
  });

  it('PUT /perfil/completo com renda bruta sem o bruto (regra do domínio) → 400 e o perfil não nasce', async () => {
    const res = await sincronizar('sub-1', { ...COMPLETO, rendaInformada: 'bruta' }).expect(400);
    expect(res.body.error.details).toEqual({ salarioBruto: 'Informe o seu salário bruto' });
    await obterCompleto('sub-1').expect(404);
  });
});

it('nenhum erro inesperado (500) aconteceu em nenhum fluxo deste arquivo', () => {
  expect(errosInesperados).toEqual([]);
});
