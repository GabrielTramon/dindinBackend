import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { InMemoryCategoriasRepository } from '../../../categorias/infra';
import { InMemoryCheckInsRepository } from '../../../check-ins/infra';
import { InMemoryDividasRepository } from '../../../dividas/infra';
import { InMemoryGastosFixosRepository } from '../../../gastos-fixos/infra';
import { InMemorySubscribersRepository } from '../../../identidade/infra';
import { InMemoryMetasRepository } from '../../../metas/infra';
import { InMemoryGruposRepository } from '../../../organizacao/infra';
import { InMemoryPerfisRepository } from '../../../perfil/infra';
import { InMemoryVersoesPlanoRepository } from '../../../planos/infra';
import {
  ANA,
  BRUNO,
  CAMPOS_INTERNOS,
  chavesDoJson,
  CONTA_APAGADA,
  CONTA_COMPLETA,
  criarContaCompleta,
  exportacaoEsperada,
  retratoDa,
  type RepositoriosDaConta,
} from '../../application/privacidade.contract';
import { createPrivacidadeModule } from '../../infra';

let kit: TestKit;
let r: RepositoriosDaConta;
let app: ReturnType<TestKit['app']>;

/** Os repositórios em memória de verdade, ligados como o container liga (ver privacidade.use-cases.test.ts). */
function repositoriosEmMemoria(): RepositoriosDaConta {
  const subscribers = new InMemorySubscribersRepository();
  const contaExiste = async (id: string) => (await subscribers.findById(id)) !== null;
  const perfis = new InMemoryPerfisRepository({ subscriberExists: contaExiste });
  const categorias = new InMemoryCategoriasRepository({
    withCatalog: true,
    isInUse: (id) => gastosFixos.existsForCategory(id),
  });
  const gastosFixos = new InMemoryGastosFixosRepository({
    perfilExists: (id) => perfis.exists(id),
    categoriaExists: async (id) => (await categorias.findById(id)) !== null,
  });
  return {
    subscribers,
    perfis,
    categorias,
    gastosFixos,
    dividas: new InMemoryDividasRepository({ perfilExists: (id) => perfis.exists(id) }),
    versoesPlano: new InMemoryVersoesPlanoRepository(),
    metas: new InMemoryMetasRepository(),
    checkIns: new InMemoryCheckInsRepository({ subscriberExists: contaExiste }),
    grupos: new InMemoryGruposRepository(),
    ids: kit.ids,
  };
}

beforeEach(() => {
  kit = createTestKit();
  r = repositoriosEmMemoria();
  app = kit.app((api) => api.use(createPrivacidadeModule({ ...kit.deps, ...r }).router));
});

// o kit é novo a cada teste: junta os 500 de todos pra conferir no fim do arquivo
const errosInesperados: unknown[] = [];
afterEach(() => {
  errosInesperados.push(...kit.unexpectedErrors);
});

const exportar = (subscriberId: string) =>
  request(app).get('/api/v1/me/exportar').set('Authorization', kit.bearer(subscriberId));
const excluir = (subscriberId: string, corpo?: object) => {
  const pedido = request(app).delete('/api/v1/me').set('Authorization', kit.bearer(subscriberId));
  return corpo === undefined ? pedido : pedido.send(corpo);
};

/** a exportação esperada como sai no JSON: datas em ISO */
const comoJson = (valor: unknown): unknown => JSON.parse(JSON.stringify(valor));

describe('GET /api/v1/me/exportar', () => {
  it('200: arquivo pra baixar com tudo da pessoa, com nome datado e sem cache', async () => {
    const ana = await criarContaCompleta(r, ANA);
    await criarContaCompleta(r, BRUNO);

    const res = await exportar(ana.subscriberId).expect(200);

    expect(res.headers['content-disposition']).toBe('attachment; filename="dindin-meus-dados-2026-09-17.json"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.body).toEqual(comoJson(exportacaoEsperada(ANA, kit.clock.now())));
    expect(res.body.exportadoEm).toBe('2026-09-17T12:00:00.000Z');
  });

  it('nada de outra pessoa nem campo interno: sem id, dono ou hash em lugar nenhum do arquivo', async () => {
    const ana = await criarContaCompleta(r, ANA);
    const bruno = await criarContaCompleta(r, BRUNO);

    // não há parâmetro que escolha de quem é a exportação: o dono vem só do token
    const res = await request(app)
      .get(`/api/v1/me/exportar?subscriberId=${bruno.subscriberId}`)
      .set('Authorization', kit.bearer(ana.subscriberId))
      .expect(200);

    expect(res.body.conta.email).toBe(ANA.email);
    expect(res.text).not.toContain(BRUNO.email);
    expect(res.text).not.toContain(bruno.subscriberId);
    // a conta de teste tem senha: nem o hash nem o formato dele aparecem no arquivo
    expect(res.text).not.toContain('hash-da-senha');
    expect(res.text).not.toContain('scrypt$');
    const chaves = chavesDoJson(res.body);
    expect(CAMPOS_INTERNOS.filter((campo) => chaves.has(campo))).toEqual([]);
  });

  it('o nome do arquivo usa a data de São Paulo: 23h30 do dia 17 ainda é dia 17', async () => {
    const ana = await criarContaCompleta(r, ANA);
    kit.clock.set('2026-09-18T02:30:00.000Z');

    const res = await exportar(ana.subscriberId).expect(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="dindin-meus-dados-2026-09-17.json"');
    expect(res.body.exportadoEm).toBe('2026-09-18T02:30:00.000Z');
  });

  it('sem token → 401; token inválido → 401', async () => {
    const semToken = await request(app).get('/api/v1/me/exportar').expect(401);
    expect(semToken.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: 'Entre pra continuar.' });
    await request(app).get('/api/v1/me/exportar').set('Authorization', 'Bearer lixo').expect(401);
  });

  it('conta que não existe mais (excluída depois de conferir a sessão) → 404', async () => {
    // o kit diz que toda sessão tem conta; o repositório não tem esta: é a corrida entre o middleware e o caso de uso
    const res = await exportar('conta-que-sumiu').expect(404);
    expect(res.body.error).toMatchObject({ code: 'NAO_ENCONTRADO', message: 'Conta não encontrada.' });
  });
});

describe('DELETE /api/v1/me', () => {
  it('204 apaga tudo da pessoa, inclusive o gasto em categoria personalizada, e nada da outra', async () => {
    const ana = await criarContaCompleta(r, ANA);
    const bruno = await criarContaCompleta(r, BRUNO);

    const res = await excluir(ana.subscriberId, { confirmacao: 'EXCLUIR' }).expect(204);

    expect(res.text).toBe('');
    expect(await retratoDa(r, ana.subscriberId)).toEqual(CONTA_APAGADA);
    expect(await r.categorias.findById(ana.categoriaComGastoId)).toBeNull();
    expect(await retratoDa(r, bruno.subscriberId)).toEqual(CONTA_COMPLETA);
  });

  it('o dono vem do token: subscriberId de outra pessoa no corpo é ignorado', async () => {
    const ana = await criarContaCompleta(r, ANA);
    const bruno = await criarContaCompleta(r, BRUNO);

    await excluir(ana.subscriberId, { confirmacao: 'EXCLUIR', subscriberId: bruno.subscriberId }).expect(204);

    expect(await retratoDa(r, ana.subscriberId)).toEqual(CONTA_APAGADA);
    expect(await retratoDa(r, bruno.subscriberId)).toEqual(CONTA_COMPLETA);
  });

  it('sem token → 401 e nada é apagado', async () => {
    const ana = await criarContaCompleta(r, ANA);
    const res = await request(app).delete('/api/v1/me').send({ confirmacao: 'EXCLUIR' }).expect(401);
    expect(res.body.error.code).toBe('NAO_AUTENTICADO');
    expect(await retratoDa(r, ana.subscriberId)).toEqual(CONTA_COMPLETA);
  });

  it.each([
    ['sem corpo', undefined],
    ['corpo vazio', {}],
    ['em minúsculas (regra do caso de uso)', { confirmacao: 'excluir' }],
    ['outra palavra (regra do caso de uso)', { confirmacao: 'SIM' }],
    ['número', { confirmacao: 1 }],
    ['texto longo demais', { confirmacao: 'EXCLUIR'.repeat(20) }],
  ])('confirmação %s → 400 no campo, e nada é apagado', async (_caso, corpo) => {
    const ana = await criarContaCompleta(r, ANA);

    const res = await excluir(ana.subscriberId, corpo).expect(400);

    expect(res.body.error.code).toBe('VALIDACAO');
    expect(res.body.error.details).toEqual({ confirmacao: 'Digite EXCLUIR pra confirmar' });
    expect(await retratoDa(r, ana.subscriberId)).toEqual(CONTA_COMPLETA);
  });

  it('JSON malformado → 400 JSON_INVALIDO, e nada é apagado', async () => {
    const ana = await criarContaCompleta(r, ANA);
    const res = await request(app)
      .delete('/api/v1/me')
      .set('Authorization', kit.bearer(ana.subscriberId))
      .set('Content-Type', 'application/json')
      .send('{"confirmacao":')
      .expect(400);
    expect(res.body.error.code).toBe('JSON_INVALIDO');
    expect(await retratoDa(r, ana.subscriberId)).toEqual(CONTA_COMPLETA);
  });

  it('depois da exclusão, a mesma sessão dá 401 nas duas rotas', async () => {
    const ana = await criarContaCompleta(r, ANA);
    const sessao = kit.bearer(ana.subscriberId);
    await request(app).delete('/api/v1/me').set('Authorization', sessao).send({ confirmacao: 'EXCLUIR' }).expect(204);

    // o kit simula a conta excluída; no main, o SessionAccounts consulta subscribers.findById
    // e a exclusão já derruba a sessão sozinha (provado no teste seguinte)
    kit.sessionAccounts.markDeleted(ana.subscriberId);

    await request(app).get('/api/v1/me/exportar').set('Authorization', sessao).expect(401);
    await request(app).delete('/api/v1/me').set('Authorization', sessao).send({ confirmacao: 'EXCLUIR' }).expect(401);
  });

  it('ligado como o main liga (sessão lida em subscribers.findById), a exclusão encerra a sessão sozinha', async () => {
    const auth = createAuthMiddlewares(kit.authTokens, {
      sessionVersion: async (id) => (await r.subscribers.findById(id))?.versaoSessao ?? null,
    });
    const comoNoMain = kit.app((api) => api.use(createPrivacidadeModule({ ...kit.deps, ...r, auth }).router));
    const ana = await criarContaCompleta(r, ANA);
    const bruno = await criarContaCompleta(r, BRUNO);
    const sessao = kit.bearer(ana.subscriberId);

    await request(comoNoMain).get('/api/v1/me/exportar').set('Authorization', sessao).expect(200);
    await request(comoNoMain).delete('/api/v1/me').set('Authorization', sessao).send({ confirmacao: 'EXCLUIR' }).expect(204);

    const depois = await request(comoNoMain).get('/api/v1/me/exportar').set('Authorization', sessao).expect(401);
    expect(depois.body.error.code).toBe('NAO_AUTENTICADO');
    // a sessão da outra pessoa continua valendo
    await request(comoNoMain).get('/api/v1/me/exportar').set('Authorization', kit.bearer(bruno.subscriberId)).expect(200);
  });
});

it('nenhum erro inesperado (500) aconteceu em nenhum fluxo deste arquivo', () => {
  expect(errosInesperados).toEqual([]);
});
