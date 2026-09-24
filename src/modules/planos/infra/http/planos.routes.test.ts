import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeCursor } from '../../../../shared/application/pagination';
import { ConflictError } from '../../../../shared/domain/errors';
import { gerarPlano } from '../../../../shared/motor/motor';
import { createTestKit, type TestKit } from '../../../../test/kit';
import type { PerfilDoMotorReader } from '../../application/ports';
import type { PerfilDoMotor, VersaoPlano } from '../../domain/versao-plano';
import { createPlanosModule } from '../../infra';
import { InMemoryVersoesPlanoRepository } from '../database/in-memory-versoes-plano-repository';

/** CLT de 24 anos, aluguel, cartão rodando e um gasto de nome livre. */
const ANA: PerfilDoMotor = {
  rendaMensal: 3200,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1100,
  gastosFixos: [
    { categoria: 'mercado', valor: 650 },
    { categoria: 'internet', valor: 99.9 },
    { categoria: 'transporte_publico', valor: 220 },
    { categoria: 'outro', nome: 'Clube do bairro', valor: 45 },
  ],
  dividas: [{ tipo: 'rotativo', saldo: 1800, parcela: 150 }],
  guardado: 400,
};

/** Estudante de 19 anos que mora com os pais, sem dívida. */
const CAIO: PerfilDoMotor = {
  rendaMensal: 1850.5,
  tipoRenda: 'informal',
  idade: 19,
  moradia: 'pais',
  custoMoradia: 0,
  gastosFixos: [
    { categoria: 'celular', valor: 49.99 },
    { categoria: 'curso', valor: 189 },
  ],
  dividas: [],
  guardado: 150,
};

/** Toda gravação bate na unique, como se outra requisição sempre chegasse antes. */
class VersoesSempreEmCorrida extends InMemoryVersoesPlanoRepository {
  override async save(_versao: VersaoPlano): Promise<void> {
    throw new ConflictError('Essa versão do plano já foi gravada.');
  }
}

let kit: TestKit;
let app: ReturnType<TestKit['app']>;
let versoesPlano: InMemoryVersoesPlanoRepository;
let perfis: Map<string, PerfilDoMotor>;

const perfilReader: PerfilDoMotorReader = {
  load: async (subscriberId) => {
    const perfil = perfis.get(subscriberId);
    return perfil ? structuredClone(perfil) : null;
  },
};

const montar = (repositorio: InMemoryVersoesPlanoRepository) =>
  kit.app((api) => api.use(createPlanosModule({ ...kit.deps, versoesPlano: repositorio, perfilReader }).router));

beforeEach(() => {
  kit = createTestKit();
  versoesPlano = new InMemoryVersoesPlanoRepository();
  perfis = new Map([
    ['sub-1', structuredClone(ANA)],
    ['sub-2', structuredClone(CAIO)],
  ]);
  app = montar(versoesPlano);
});

// o kit é recriado a cada teste: conferir só no fim do arquivo deixaria passar um 500 dos testes anteriores
afterEach(() => {
  expect(kit.unexpectedErrors).toEqual([]);
});

const gerar = (subscriberId: string) =>
  request(app).post('/api/v1/planos').set('Authorization', kit.bearer(subscriberId));

/** o corpo que o JSON carrega: undefined some, Date vira texto */
const comoJson = <T>(valor: T): T => JSON.parse(JSON.stringify(valor)) as T;

describe('POST /api/v1/planos', () => {
  it('201 com Location na primeira vez; 200 com a mesma versão quando nada mudou', async () => {
    const primeira = await gerar('sub-1').expect(201);
    expect(primeira.headers.location).toBe('/api/v1/planos/1');
    expect(primeira.body).toEqual({
      versao: 1,
      criadoEm: '2026-09-17T12:00:00.000Z',
      entrada: ANA,
      resultado: comoJson(gerarPlano(structuredClone(ANA))),
    });

    kit.clock.advance(60_000);
    const segunda = await gerar('sub-1').expect(200);
    expect(segunda.headers.location).toBeUndefined();
    expect(segunda.body).toEqual(primeira.body);
  });

  it('perfil mudou → 201 com a versão 2', async () => {
    await gerar('sub-1').expect(201);
    perfis.set('sub-1', { ...structuredClone(ANA), guardado: 2500 });

    const res = await gerar('sub-1').expect(201);
    expect(res.headers.location).toBe('/api/v1/planos/2');
    expect(res.body).toMatchObject({ versao: 2, entrada: { guardado: 2500 } });
  });

  it('não expõe dono nem id interno', async () => {
    const res = await gerar('sub-1').expect(201);
    expect(Object.keys(res.body).sort()).toEqual(['criadoEm', 'entrada', 'resultado', 'versao']);
    expect(JSON.stringify(res.body)).not.toContain('sub-1');
  });

  it('corpo é ignorado: dono e perfil forjados não entram no plano', async () => {
    const res = await gerar('sub-1').send({ subscriberId: 'sub-2', perfil: CAIO, rendaMensal: 1 }).expect(201);
    expect(res.body.entrada).toEqual(ANA);
    await request(app).get('/api/v1/planos/atual').set('Authorization', kit.bearer('sub-2')).expect(404);
  });

  it('sem token → 401 no formato padrão', async () => {
    const res = await request(app).post('/api/v1/planos').expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: 'Entre pra continuar.' });
  });

  it('sem perfil respondido → 422 com a mensagem da tela', async () => {
    const res = await gerar('sub-sem-perfil').expect(422);
    expect(res.body.error).toMatchObject({
      code: 'REGRA_DE_NEGOCIO',
      message: 'Responda o seu perfil antes de gerar o plano.',
    });
  });

  it('JSON malformado → 400 JSON_INVALIDO', async () => {
    const res = await gerar('sub-1').set('Content-Type', 'application/json').send('{"perfil":').expect(400);
    expect(res.body.error.code).toBe('JSON_INVALIDO');
  });

  it('corrida que não se resolve nas tentativas → 409 pra tentar de novo', async () => {
    app = montar(new VersoesSempreEmCorrida());
    const res = await gerar('sub-1').expect(409);
    expect(res.body.error).toMatchObject({
      code: 'CONFLITO',
      message: 'Outro cálculo do plano estava em andamento. Tente de novo.',
    });
  });
});

describe('GET /api/v1/planos/atual', () => {
  it('200 com a versão mais nova', async () => {
    await gerar('sub-1').expect(201);
    perfis.set('sub-1', { ...structuredClone(ANA), idade: 25 });
    await gerar('sub-1').expect(201);

    const res = await request(app).get('/api/v1/planos/atual').set('Authorization', kit.bearer('sub-1')).expect(200);
    expect(res.body).toMatchObject({ versao: 2, entrada: { idade: 25 } });
    expect(res.body.resultado.decisao.titulo).toEqual(expect.any(String));
  });

  it('sem plano, ou com plano só de outra pessoa → 404', async () => {
    await gerar('sub-1').expect(201);
    const res = await request(app).get('/api/v1/planos/atual').set('Authorization', kit.bearer('sub-2')).expect(404);
    expect(res.body.error).toMatchObject({ code: 'NAO_ENCONTRADO', message: 'Você ainda não gerou um plano.' });
  });

  it('sem token → 401', async () => {
    await request(app).get('/api/v1/planos/atual').expect(401);
  });
});

describe('GET /api/v1/planos', () => {
  const gerarTresVersoes = async () => {
    for (const guardado of [100, 200, 300]) {
      perfis.set('sub-1', { ...structuredClone(ANA), guardado });
      kit.clock.advance(24 * 60 * 60 * 1000);
      await gerar('sub-1').expect(201);
    }
  };

  const listar = (subscriberId: string, query: Record<string, string | number> = {}) =>
    request(app).get('/api/v1/planos').query(query).set('Authorization', kit.bearer(subscriberId));

  it('200 com o resumo de cada versão, paginado da mais nova pra mais antiga', async () => {
    await gerarTresVersoes();

    const p1 = await listar('sub-1', { limit: 2 }).expect(200);
    const plano3 = gerarPlano({ ...structuredClone(ANA), guardado: 300 });
    expect(p1.body.items[0]).toEqual({
      versao: 3,
      criadoEm: '2026-09-20T12:00:00.000Z',
      degrau: plano3.degrau,
      modoCorte: plano3.modoCorte,
      aporte: plano3.aporte,
      livre: plano3.livre,
      decisao: plano3.decisao.titulo,
    });
    expect(p1.body.items.map((i: { versao: number }) => i.versao)).toEqual([3, 2]);
    expect(p1.body.nextCursor).toEqual(expect.any(String));

    const p2 = await listar('sub-1', { limit: 2, cursor: p1.body.nextCursor }).expect(200);
    expect(p2.body).toEqual({ items: [expect.objectContaining({ versao: 1 })], nextCursor: null });
  });

  it('outra pessoa não vê o histórico de ninguém', async () => {
    await gerarTresVersoes();
    const res = await listar('sub-2').expect(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    [{ limit: 0 }, 'limit'],
    [{ limit: 101 }, 'limit'],
    [{ limit: 'muitos' }, 'limit'],
    [{ cursor: 'lixo!!' }, 'cursor'],
    [{ cursor: encodeCursor('abc') }, 'cursor'],
  ])('query inválida %j → 400 com o campo', async (query, campo) => {
    const res = await listar('sub-1', query).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details).toHaveProperty(campo);
  });

  it('sem token → 401', async () => {
    await request(app).get('/api/v1/planos').expect(401);
  });
});

describe('GET /api/v1/planos/:versao', () => {
  it('200 com a versão pedida do histórico', async () => {
    await gerar('sub-1').expect(201);
    perfis.set('sub-1', { ...structuredClone(ANA), rendaMensal: 4100 });
    await gerar('sub-1').expect(201);

    const res = await request(app).get('/api/v1/planos/1').set('Authorization', kit.bearer('sub-1')).expect(200);
    expect(res.body).toMatchObject({ versao: 1, entrada: ANA });
  });

  it('versão de outra pessoa ou inexistente → 404', async () => {
    await gerar('sub-1').expect(201);
    const deOutra = await request(app).get('/api/v1/planos/1').set('Authorization', kit.bearer('sub-2')).expect(404);
    expect(deOutra.body.error).toMatchObject({ code: 'NAO_ENCONTRADO', message: 'Versão do plano não encontrada.' });
    await request(app).get('/api/v1/planos/2').set('Authorization', kit.bearer('sub-1')).expect(404);
  });

  it.each(['abc', '0', '-1', '1.5', '1e2', '0x10', '2147483648', '99999999999'])('versão %j → 400', async (versao) => {
    const res = await request(app)
      .get(`/api/v1/planos/${versao}`)
      .set('Authorization', kit.bearer('sub-1'))
      .expect(400);
    expect(res.body.error.details).toEqual({ versao: 'Versão inválida' });
  });

  it('sem token → 401', async () => {
    await request(app).get('/api/v1/planos/1').expect(401);
  });
});

describe('POST /api/v1/planos/simular', () => {
  const simular = (corpo: unknown) => request(app).post('/api/v1/planos/simular').send(corpo as object);

  it('público: 200 sem token, com o plano do motor', async () => {
    const res = await simular(CAIO).expect(200);
    expect(res.body).toEqual({ resultado: comoJson(gerarPlano(structuredClone(CAIO))) });
  });

  it('não grava nada, nem com a pessoa autenticada', async () => {
    await request(app)
      .post('/api/v1/planos/simular')
      .set('Authorization', kit.bearer('sub-1'))
      .send(ANA)
      .expect(200);
    await simular(ANA).expect(200);

    expect(await versoesPlano.findLatest('sub-1')).toBeNull();
    await request(app).get('/api/v1/planos').set('Authorization', kit.bearer('sub-1')).expect(200, {
      items: [],
      nextCursor: null,
    });
  });

  it('chaves desconhecidas são descartadas e o nome livre chega aparado', async () => {
    const res = await simular({
      ...CAIO,
      subscriberId: 'sub-1',
      gastosFixos: [{ categoria: 'outro', nome: '  Clube  ', valor: 30, extra: true }],
    }).expect(200);
    expect(res.body.resultado.perfil).not.toHaveProperty('subscriberId');
    expect(res.body.resultado.perfil.gastosFixos).toEqual([{ categoria: 'outro', nome: 'Clube', valor: 30 }]);
  });

  it('corpo inválido → 400 com as mesmas mensagens e chaves do frontend', async () => {
    const res = await simular({
      ...CAIO,
      rendaMensal: undefined,
      idade: 12,
      gastosFixos: [{ categoria: 'iate', valor: 10 }],
    }).expect(400);
    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details).toEqual({
      rendaMensal: 'Informe quanto entra por mês',
      idade: 'A partir de 14 anos',
      'gastosFixos.0.categoria': 'Categoria desconhecida',
    });
  });

  it('dinheiro com mais de 2 casas (taxa: 4) → 400 por campo', async () => {
    const res = await simular({
      ...CAIO,
      guardado: 150.005,
      gastosFixos: [{ categoria: 'curso', valor: 189.999 }],
      dividas: [{ tipo: 'emprestimo', saldo: 1000, parcela: 99.9, taxaAnual: 0.12345 }],
    }).expect(400);
    expect(res.body.error.details).toEqual({
      guardado: 'No máximo 2 casas decimais',
      'gastosFixos.0.valor': 'No máximo 2 casas decimais',
      'dividas.0.taxaAnual': 'No máximo 4 casas decimais',
    });
  });

  it('parcela maior que o saldo → 400 no campo da parcela (a trava do onboarding)', async () => {
    const res = await simular({ ...CAIO, dividas: [{ tipo: 'rotativo', saldo: 1000, parcela: 5000 }] }).expect(400);
    expect(res.body.error.details).toEqual({
      'dividas.0.parcela': 'A parcela está maior que o total da dívida. Confere os dois valores?',
    });
    await simular({ ...CAIO, dividas: [{ tipo: 'rotativo', saldo: 1000, parcela: 1000 }] }).expect(200);
  });

  it('centavos válidos passam (R$ 19,99 não é recusado por ponto flutuante)', async () => {
    await simular({ ...CAIO, rendaMensal: 1919.99, gastosFixos: [{ categoria: 'pet', valor: 19.99 }] }).expect(200);
  });

  it('nenhum erro inesperado (500) aconteceu nesses fluxos', () => {
    expect(kit.unexpectedErrors).toEqual([]);
  });
});
