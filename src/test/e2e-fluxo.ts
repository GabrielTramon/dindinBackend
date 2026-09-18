import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../main/app';
import { loadConfig } from '../main/config';
import { createContainer, type Container, type Repositories } from '../main/container';
import { createJobs } from '../main/jobs/jobs';
import { mountModules } from '../main/routes';
import type { ErrorLogger } from '../shared/infra/http/error-handler';
import { FixedClock, InMemoryMailer } from '../shared/infra/in-memory/doubles';
import { MAX_PAGE_LIMIT } from '../shared/application/pagination';
import { PROPORCAO_APORTE } from '../shared/motor/config';
import { arredondar } from '../shared/motor/format';
import { TEST_JWT_SECRET } from './kit';

/*
  O sistema inteiro, ponta a ponta, pelo HTTP: a mesma composição da produção
  (loadConfig → createContainer → createApp + mountModules), só com o e-mail em
  memória e o relógio fixo injetados no container.

  O fluxo é UM só e roda em dois lugares:
    src/test/e2e.test.ts               PERSISTENCIA=memoria (yarn test)
    src/test/e2e.integration.test.ts   PERSISTENCIA=prisma contra Postgres/PGlite (yarn test:integration)

  Duas pessoas: Ana faz o caminho inteiro, até excluir a conta; Bruno entra no
  meio e tem que sair intacto. Toda resposta fica registrada, e no fim o fluxo
  confere que nenhuma trouxe o id da outra pessoa, hash de token ou campo interno.
*/

export const APP_URL_E2E = 'https://dindin.app';

/**
 * Os passos do fluxo, na ordem em que acontecem. Os dois arquivos de e2e
 * (memória e Postgres) conferem esta lista inteira em vez de contar: quando um
 * passo entra, sai ou muda de nome, o diff do teste diz QUAL — `toHaveLength(21)`
 * só dizia "22 ≠ 21" e mandava a pessoa procurar.
 */
export const PASSOS_DO_FLUXO = [
  'a API está de pé e a persistência responde',
  'Ana pede o link, o reenvio em menos de 60 s é segurado, e ela entra',
  'sem perfil: gerar plano é 422 e adicionar gasto é 422',
  'PUT /perfil/completo com o perfil do onboarding do frontend',
  'GET /perfil/completo e GET /perfil devolvem o que ficou gravado',
  'mandar o mesmo perfil de novo não muda nada e mantém os ids dos gastos',
  'CRUD de /perfil/gastos-fixos',
  'CRUD de /perfil/dividas',
  'o perfil completo reflete o CRUD',
  'POST /planos cria a versão 1 (201) e de novo devolve a mesma (200)',
  'perfil muda → POST /planos cria a versão 2; histórico e atual acompanham',
  'meta: criar, publicar e ver a página pública sem token e sem valores em reais',
  'Bruno entra no meio, monta o perfil, gera plano e cria meta',
  'Bruno não enxerga nem mexe em nada da Ana (404, igual a inexistente)',
  'PUT /check-ins do mês anterior compara com a versão que valia naquele mês',
  'salário bruto, dependentes, ritmo e meta atravessam o perfil e chegam no plano',
  'plano novo não reescreve o passado: o check-in de agosto continua igual',
  'PUT /organizacao guarda a árvore de grupos, e o PUT seguinte substitui ela inteira',
  'job do dia 1 abre setembro e manda o e-mail com descadastro no fragmento; rodar de novo não duplica',
  'descadastro pelo link do e-mail: sessão não serve como token; o do e-mail vale e é idempotente',
  'GET /me/exportar traz tudo da Ana e nada do Bruno',
  'DELETE /me exige a confirmação; com ela apaga, e a mesma sessão passa a dar 401',
  'Bruno continua intacto',
  'nenhuma resposta vazou id de outra pessoa, hash de token ou campo interno',
] as const;

export interface AmbienteE2E {
  container: Container;
  app: Express;
  mailer: InMemoryMailer;
  clock: FixedClock;
  /** erros 500: o fluxo termina conferindo que ficou vazio */
  errosInesperados: unknown[];
}

/** Monta a API como o server.ts monta, com as variáveis de `env` por cima das de teste. */
export function montarAmbiente(env: Record<string, string> = {}): AmbienteE2E {
  const config = loadConfig({
    NODE_ENV: 'test',
    PERSISTENCIA: 'memoria',
    JWT_SECRET: TEST_JWT_SECRET,
    APP_URL: APP_URL_E2E,
    CORS_ORIGIN: APP_URL_E2E,
    LOG_REQUESTS: 'false',
    ...env,
  });
  const mailer = new InMemoryMailer();
  const clock = new FixedClock('2026-09-17T12:00:00.000Z');
  const container = createContainer(config, { mailer, clock });

  const errosInesperados: unknown[] = [];
  const errorLogger: ErrorLogger = { error: (_mensagem, contexto) => errosInesperados.push(contexto) };
  const app = createApp({
    mount: (api) => mountModules(api, container),
    corsOrigins: config.corsOrigins,
    trustProxy: config.trustProxy,
    logRequests: config.logRequests,
    readiness: container.readiness,
    errorLogger,
  });
  return { container, app, mailer, clock, errosInesperados };
}

// ── o perfil como o onboarding do frontend manda ─────────────────────────────

/**
 * Realista de propósito: slug do catálogo, "outro" com nome repetido (e com
 * espaço e minúscula), "outro" com o nome de uma categoria do catálogo e uma
 * dívida de rotativo sem taxa (o motor usa a padrão do tipo).
 */
export const PERFIL_DA_ANA = {
  rendaMensal: 4800,
  tipoRenda: 'clt',
  idade: 29,
  moradia: 'aluguel',
  custoMoradia: 1400,
  guardado: 2500.5,
  gastosFixos: [
    { categoria: 'mercado', valor: 700 },
    { categoria: 'internet', valor: 99.9 },
    { categoria: 'outro', nome: 'Clube', valor: 80 },
    { categoria: 'outro', nome: ' clube ', valor: 25.5 },
    { categoria: 'outro', nome: 'Academia', valor: 119.9 },
    { categoria: 'streaming', valor: 55.9 },
  ],
  dividas: [{ tipo: 'rotativo', saldo: 1800 }],
} as const;

/** O que o servidor guardou: "Clube" somado, "Academia" virou o slug, ordem do maior gasto pro menor. */
export const PERFIL_DA_ANA_GRAVADO = {
  rendaMensal: 4800,
  tipoRenda: 'clt',
  idade: 29,
  moradia: 'aluguel',
  custoMoradia: 1400,
  guardado: 2500.5,
  gastosFixos: [
    { categoria: 'mercado', valor: 700 },
    { categoria: 'academia', valor: 119.9 },
    { categoria: 'outro', nome: 'Clube', valor: 105.5 },
    { categoria: 'internet', valor: 99.9 },
    { categoria: 'streaming', valor: 55.9 },
  ],
  dividas: [{ tipo: 'rotativo', saldo: 1800 }],
};

/** Só categorias do catálogo: no fim, o banco tem que ter as 24 do catálogo e nenhuma personalizada. */
export const PERFIL_DO_BRUNO = {
  rendaMensal: 2600,
  tipoRenda: 'pj',
  idade: 22,
  moradia: 'pais',
  custoMoradia: 0,
  guardado: 0,
  gastosFixos: [
    { categoria: 'transporte_publico', valor: 220 },
    { categoria: 'celular', valor: 59.99 },
  ],
  dividas: [],
};

// ── o que os repositórios guardam de uma conta ───────────────────────────────

export interface RetratoDaConta {
  conta: boolean;
  perfil: boolean;
  gastosFixos: number;
  dividas: number;
  planos: number;
  metas: number;
  checkIns: number;
  categoriasPersonalizadas: number;
  grupos: number;
  /** contados à parte do grupo: é o que um cascade esquecido deixaria pra trás */
  itensDeGrupo: number;
}

export const CONTA_INEXISTENTE: RetratoDaConta = {
  conta: false,
  perfil: false,
  gastosFixos: 0,
  dividas: 0,
  planos: 0,
  metas: 0,
  checkIns: 0,
  categoriasPersonalizadas: 0,
  grupos: 0,
  itensDeGrupo: 0,
};

export async function retratoDaConta(r: Repositories, subscriberId: string): Promise<RetratoDaConta> {
  const pagina = { limit: MAX_PAGE_LIMIT, cursor: null };
  const [conta, perfil, gastos, dividas, planos, metas, checkIns, categorias, grupos] = await Promise.all([
    r.subscribers.findById(subscriberId),
    r.perfis.exists(subscriberId),
    r.gastosFixos.listBySubscriber(subscriberId),
    r.dividas.listBySubscriber(subscriberId),
    r.versoesPlano.list(subscriberId, pagina),
    r.metas.listBySubscriber(subscriberId),
    r.checkIns.list(subscriberId, pagina),
    r.categorias.listVisible(subscriberId),
    r.grupos.listBySubscriber(subscriberId),
  ]);
  return {
    conta: conta !== null,
    perfil,
    gastosFixos: gastos.length,
    dividas: dividas.length,
    planos: planos.items.length,
    metas: metas.length,
    checkIns: checkIns.items.length,
    categoriasPersonalizadas: categorias.filter((c) => !c.ehDoCatalogo).length,
    grupos: grupos.length,
    itensDeGrupo: grupos.reduce((total, grupo) => total + grupo.itens.length, 0),
  };
}

// ── cliente HTTP que registra tudo ───────────────────────────────────────────

type Ator = 'ana' | 'bruno' | 'anonimo';
type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RespostaRegistrada {
  ator: Ator;
  rota: string;
  status: number;
  texto: string;
  corpo: unknown;
}

interface Pessoa {
  ator: Ator;
  email: string;
  id: string;
  /** token de sessão (Authorization: Bearer) */
  sessao: string;
}

class ApiRegistrada {
  readonly respostas: RespostaRegistrada[] = [];

  constructor(private readonly app: Express) {}

  async chamar(
    ator: Ator,
    metodo: Metodo,
    caminho: string,
    opcoes: { sessao?: string; corpo?: object; status?: number } = {},
  ) {
    let pedido = request(this.app)[metodo](caminho.startsWith('/api/') ? caminho : `/api/v1${caminho}`);
    if (opcoes.sessao) pedido = pedido.set('Authorization', `Bearer ${opcoes.sessao}`);
    if (opcoes.corpo !== undefined) pedido = pedido.send(opcoes.corpo);
    const res = await pedido;
    const rota = `${metodo.toUpperCase()} ${caminho}`;
    this.respostas.push({ ator, rota, status: res.status, texto: res.text ?? '', corpo: res.body });
    if (opcoes.status !== undefined) expect(res.status, `${rota} → ${res.text}`).toBe(opcoes.status);
    return res;
  }
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** O token de um link do e-mail. Tem que estar no fragmento (#token=), nunca na query. */
function tokenNoFragmento(texto: string, caminho: string): string {
  expect(texto, 'token na query da URL').not.toMatch(/[?&]token=/);
  const achado = new RegExp(`${escaparRegex(`${APP_URL_E2E}${caminho}`)}#token=([^\\s"<]+)`).exec(texto);
  expect(achado, `link ${caminho}#token=… no e-mail`).not.toBeNull();
  return decodeURIComponent(achado![1]!);
}

function chavesDoJson(valor: unknown, chaves = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((item) => chavesDoJson(item, chaves));
  else if (valor !== null && typeof valor === 'object') {
    for (const [chave, filho] of Object.entries(valor)) {
      chaves.add(chave);
      chavesDoJson(filho, chaves);
    }
  }
  return chaves;
}

/** chaves que nenhum JSON de resposta pode ter (dono, chave interna, segredo do link) */
const CAMPOS_QUE_NUNCA_SAEM = ['subscriberId', 'profileId', 'tokenHash', 'token', 'tokenExpiraEm'];

// ── o fluxo ──────────────────────────────────────────────────────────────────

export interface ResultadoDoFluxo {
  ana: Pessoa;
  bruno: Pessoa;
  /** os passos que passaram, na ordem */
  passos: string[];
  /** quantas requisições HTTP o fluxo fez */
  requisicoes: number;
}

export async function executarFluxoCompleto(amb: AmbienteE2E): Promise<ResultadoDoFluxo> {
  const api = new ApiRegistrada(amb.app);
  const { mailer, clock } = amb;
  const r = amb.container.repositories;
  const passos: string[] = [];
  const tokensMagicos: string[] = [];

  /**
   * Cada passo acontece um minuto depois do anterior: datas de criação não
   * empatam. O nome é tipado por PASSOS_DO_FLUXO — passo novo sem entrada na
   * lista não compila, em vez de só mudar uma contagem.
   */
  async function passo(nome: (typeof PASSOS_DO_FLUXO)[number], trabalho: () => Promise<void>): Promise<void> {
    clock.advance(60_000);
    try {
      await trabalho();
    } catch (erro) {
      if (erro instanceof Error) erro.message = `passo "${nome}": ${erro.message}`;
      throw erro;
    }
    passos.push(nome);
  }

  async function entrar(ator: Ator, email: string, conferirReenvio = false): Promise<Pessoa> {
    const antes = mailer.sent.length;
    const pedido = await api.chamar(ator, 'post', '/auth/link-magico', { corpo: { email }, status: 202 });
    expect(pedido.body).toEqual({ message: 'Se esse e-mail puder entrar, o link chega em instantes.' });
    expect(mailer.sent.length).toBe(antes + 1);
    const mensagem = mailer.last()!;
    expect(mensagem.to).toBe(email.trim().toLowerCase());
    const token = tokenNoFragmento(mensagem.text, '/entrar');
    tokensMagicos.push(token);

    if (conferirReenvio) {
      // mesmo e-mail antes de 60 s: a mesma resposta, e nenhum e-mail novo (não revela nada, não lota a caixa)
      const reenvio = await api.chamar(ator, 'post', '/auth/link-magico', { corpo: { email }, status: 202 });
      expect(reenvio.body).toEqual(pedido.body);
      expect(mailer.sent.length).toBe(antes + 1);
    }

    const verificado = await api.chamar(ator, 'post', '/auth/verificar', { corpo: { token }, status: 200 });
    expect(verificado.headers['cache-control']).toBe('no-store');
    expect(verificado.body).toMatchObject({
      accessToken: expect.any(String),
      expiresAt: expect.any(String),
      subscriber: { email: email.trim().toLowerCase(), emailVerificadoEm: clock.now().toISOString(), ativo: true },
    });

    // link é de uso único
    await api.chamar(ator, 'post', '/auth/verificar', { corpo: { token }, status: 401 });

    return {
      ator,
      email: email.trim().toLowerCase(),
      id: verificado.body.subscriber.id,
      sessao: verificado.body.accessToken,
    };
  }

  let ana!: Pessoa;
  let bruno!: Pessoa;
  let perfilAtual: unknown;
  let idsDosGastos: Record<string, string> = {};
  let idDaDividaDaAna = '';
  /** a versão que já existia quando agosto aconteceu: é com ela que o check-in de agosto compara */
  let planoV1: { versao: number; resultado: { aporte: number; livre: number } } | undefined;
  let metaDaAna = { id: '', slug: '' };
  let tokenDescadastro = '';
  /** o perfil completo depois do salário bruto, do ritmo e da meta (a entrada da versão 3) */
  let perfilComRitmo: unknown;
  /** o corpo do check-in de agosto, pra provar que uma versão nova de plano não o reescreve */
  let checkInDeAgosto: unknown;

  await passo('a API está de pé e a persistência responde', async () => {
    await api.chamar('anonimo', 'get', '/api/health', { status: 200 });
    await api.chamar('anonimo', 'get', '/api/health/ready', { status: 200 });
  });

  await passo('Ana pede o link, o reenvio em menos de 60 s é segurado, e ela entra', async () => {
    ana = await entrar('ana', '  Ana.Souza@Exemplo.com ', true);
    const me = await api.chamar('ana', 'get', '/me', { sessao: ana.sessao, status: 200 });
    expect(me.headers['cache-control']).toBe('private, no-store');
    expect(me.body).toMatchObject({ id: ana.id, email: 'ana.souza@exemplo.com', ativo: true });
  });

  await passo('sem perfil: gerar plano é 422 e adicionar gasto é 422', async () => {
    await api.chamar('ana', 'post', '/planos', { sessao: ana.sessao, status: 422 });
    await api.chamar('ana', 'get', '/perfil/completo', { sessao: ana.sessao, status: 404 });
    const categorias = await api.chamar('ana', 'get', '/categorias', { sessao: ana.sessao, status: 200 });
    const mercado = categorias.body.items.find((c: { slug: string }) => c.slug === 'mercado');
    await api.chamar('ana', 'post', '/perfil/gastos-fixos', {
      sessao: ana.sessao,
      corpo: { categoriaId: mercado.id, valor: 10 },
      status: 422,
    });
  });

  await passo('PUT /perfil/completo com o perfil do onboarding do frontend', async () => {
    const res = await api.chamar('ana', 'put', '/perfil/completo', { sessao: ana.sessao, corpo: PERFIL_DA_ANA, status: 200 });
    expect(res.body).toEqual(PERFIL_DA_ANA_GRAVADO);
  });

  await passo('GET /perfil/completo e GET /perfil devolvem o que ficou gravado', async () => {
    const completo = await api.chamar('ana', 'get', '/perfil/completo', { sessao: ana.sessao, status: 200 });
    expect(completo.headers['cache-control']).toBe('private, no-store');
    expect(completo.body).toEqual(PERFIL_DA_ANA_GRAVADO);

    const escalares = await api.chamar('ana', 'get', '/perfil', { sessao: ana.sessao, status: 200 });
    expect(escalares.body).toMatchObject({
      rendaMensal: 4800,
      tipoRenda: 'clt',
      idade: 29,
      moradia: 'aluguel',
      custoMoradia: 1400,
      guardado: 2500.5,
    });

    // "Clube" virou categoria personalizada dela; "Academia" é a do catálogo
    const categorias = await api.chamar('ana', 'get', '/categorias', { sessao: ana.sessao, status: 200 });
    const personalizadas = categorias.body.items.filter((c: { personalizada: boolean }) => c.personalizada);
    expect(personalizadas).toEqual([expect.objectContaining({ nome: 'Clube', slug: null, grupo: 'outros' })]);
    expect(categorias.body.items).toHaveLength(25);
  });

  await passo('mandar o mesmo perfil de novo não muda nada e mantém os ids dos gastos', async () => {
    const antes = await api.chamar('ana', 'get', '/perfil/gastos-fixos', { sessao: ana.sessao, status: 200 });
    await api.chamar('ana', 'put', '/perfil/completo', { sessao: ana.sessao, corpo: PERFIL_DA_ANA, status: 200 });
    const depois = await api.chamar('ana', 'get', '/perfil/gastos-fixos', { sessao: ana.sessao, status: 200 });
    expect(depois.body).toEqual(antes.body);
    idsDosGastos = Object.fromEntries(
      depois.body.items.map((g: { id: string; categoria: { slug: string | null; nome: string } }) => [
        g.categoria.slug ?? g.categoria.nome,
        g.id,
      ]),
    );
  });

  await passo('CRUD de /perfil/gastos-fixos', async () => {
    const lista = await api.chamar('ana', 'get', '/perfil/gastos-fixos', { sessao: ana.sessao, status: 200 });
    expect(lista.headers['cache-control']).toBe('private, no-store');
    expect(lista.body.total).toBe(1081.2);
    expect(lista.body.items.map((g: { valor: number }) => g.valor)).toEqual([700, 119.9, 105.5, 99.9, 55.9]);
    expect(lista.body.items[2].categoria).toMatchObject({ nome: 'Clube', slug: null, personalizada: true });

    const categorias = await api.chamar('ana', 'get', '/categorias', { sessao: ana.sessao, status: 200 });
    const luz = categorias.body.items.find((c: { slug: string }) => c.slug === 'luz');

    const criado = await api.chamar('ana', 'post', '/perfil/gastos-fixos', {
      sessao: ana.sessao,
      corpo: { categoriaId: luz.id, valor: 180.35, subscriberId: 'tentativa-de-trocar-o-dono' },
      status: 201,
    });
    expect(criado.headers.location).toBe(`/api/v1/perfil/gastos-fixos/${criado.body.id}`);
    expect(criado.body).toMatchObject({ valor: 180.35, categoria: { id: luz.id, slug: 'luz', personalizada: false } });
    idsDosGastos.luz = criado.body.id;

    // uma linha por categoria
    await api.chamar('ana', 'post', '/perfil/gastos-fixos', {
      sessao: ana.sessao,
      corpo: { categoriaId: luz.id, valor: 1 },
      status: 409,
    });
    await api.chamar('ana', 'post', '/perfil/gastos-fixos', {
      sessao: ana.sessao,
      corpo: { categoriaId: luz.id, valor: 10.005 },
      status: 400,
    });

    const alterado = await api.chamar('ana', 'patch', `/perfil/gastos-fixos/${idsDosGastos.luz}`, {
      sessao: ana.sessao,
      corpo: { valor: 165.4 },
      status: 200,
    });
    expect(alterado.body.valor).toBe(165.4);

    await api.chamar('ana', 'delete', `/perfil/gastos-fixos/${idsDosGastos.internet}`, { sessao: ana.sessao, status: 204 });
    await api.chamar('ana', 'delete', `/perfil/gastos-fixos/${idsDosGastos.internet}`, { sessao: ana.sessao, status: 404 });
    await api.chamar('anonimo', 'get', '/perfil/gastos-fixos', { status: 401 });

    const final = await api.chamar('ana', 'get', '/perfil/gastos-fixos', { sessao: ana.sessao, status: 200 });
    expect(final.body.total).toBe(1146.7);
    expect(final.body.items.map((g: { categoria: { nome: string } }) => g.categoria.nome)).toEqual([
      'Mercado',
      'Luz',
      'Academia',
      'Clube',
      'Streaming e assinaturas',
    ]);
  });

  await passo('CRUD de /perfil/dividas', async () => {
    const lista = await api.chamar('ana', 'get', '/perfil/dividas', { sessao: ana.sessao, status: 200 });
    expect(lista.body.items).toEqual([
      expect.objectContaining({
        tipo: 'rotativo',
        saldo: 1800,
        parcela: null,
        taxaAnual: null,
        taxaAnualUsada: expect.any(Number),
        classe: expect.any(String),
      }),
    ]);

    const emprestimo = await api.chamar('ana', 'post', '/perfil/dividas', {
      sessao: ana.sessao,
      corpo: { tipo: 'emprestimo', saldo: 6000, parcela: 420, taxaAnual: 0.38 },
      status: 201,
    });
    expect(emprestimo.headers.location).toBe(`/api/v1/perfil/dividas/${emprestimo.body.id}`);
    expect(emprestimo.body).toMatchObject({ tipo: 'emprestimo', saldo: 6000, parcela: 420, taxaAnual: 0.38, taxaAnualUsada: 0.38 });
    idDaDividaDaAna = emprestimo.body.id;

    clock.advance(1_000);
    const cheque = await api.chamar('ana', 'post', '/perfil/dividas', {
      sessao: ana.sessao,
      corpo: { tipo: 'cheque_especial', saldo: 350 },
      status: 201,
    });

    const alterada = await api.chamar('ana', 'patch', `/perfil/dividas/${idDaDividaDaAna}`, {
      sessao: ana.sessao,
      corpo: { saldo: 5800, parcela: null },
      status: 200,
    });
    expect(alterada.body).toMatchObject({ saldo: 5800, parcela: null, taxaAnual: 0.38 });
    await api.chamar('ana', 'patch', `/perfil/dividas/${idDaDividaDaAna}`, { sessao: ana.sessao, corpo: {}, status: 400 });

    await api.chamar('ana', 'delete', `/perfil/dividas/${cheque.body.id}`, { sessao: ana.sessao, status: 204 });
    await api.chamar('ana', 'delete', `/perfil/dividas/${cheque.body.id}`, { sessao: ana.sessao, status: 404 });

    const final = await api.chamar('ana', 'get', '/perfil/dividas', { sessao: ana.sessao, status: 200 });
    expect(final.body.items.map((d: { tipo: string; saldo: number }) => [d.tipo, d.saldo])).toEqual([
      ['rotativo', 1800],
      ['emprestimo', 5800],
    ]);
  });

  await passo('o perfil completo reflete o CRUD', async () => {
    const completo = await api.chamar('ana', 'get', '/perfil/completo', { sessao: ana.sessao, status: 200 });
    perfilAtual = {
      ...PERFIL_DA_ANA_GRAVADO,
      gastosFixos: [
        { categoria: 'mercado', valor: 700 },
        { categoria: 'luz', valor: 165.4 },
        { categoria: 'academia', valor: 119.9 },
        { categoria: 'outro', nome: 'Clube', valor: 105.5 },
        { categoria: 'streaming', valor: 55.9 },
      ],
      dividas: [
        { tipo: 'rotativo', saldo: 1800 },
        { tipo: 'emprestimo', saldo: 5800, taxaAnual: 0.38 },
      ],
    };
    expect(completo.body).toEqual(perfilAtual);
  });

  await passo('POST /planos cria a versão 1 (201) e de novo devolve a mesma (200)', async () => {
    const simulado = await api.chamar('anonimo', 'post', '/planos/simular', { corpo: perfilAtual as object, status: 200 });

    const criado = await api.chamar('ana', 'post', '/planos', { sessao: ana.sessao, status: 201 });
    expect(criado.headers.location).toBe('/api/v1/planos/1');
    expect(criado.body).toMatchObject({ versao: 1, entrada: perfilAtual });
    // o servidor calcula com o que está salvo e chega no mesmo plano que a calculadora pública
    expect(criado.body.resultado).toEqual(simulado.body.resultado);
    // guardada pro check-in de agosto: é a versão mais antiga, e é a que vale pra um mês
    // anterior a todas elas (findEmVigorEm cai no fallback)
    planoV1 = criado.body;

    clock.advance(60_000);
    const denovo = await api.chamar('ana', 'post', '/planos', { sessao: ana.sessao, status: 200 });
    expect(denovo.headers.location).toBeUndefined();
    expect(denovo.body).toEqual(criado.body);

    const atual = await api.chamar('ana', 'get', '/planos/atual', { sessao: ana.sessao, status: 200 });
    expect(atual.body).toEqual(criado.body);
  });

  await passo('perfil muda → POST /planos cria a versão 2; histórico e atual acompanham', async () => {
    const perfil = await api.chamar('ana', 'patch', '/perfil', { sessao: ana.sessao, corpo: { guardado: 3200 }, status: 200 });
    expect(perfil.body.guardado).toBe(3200);
    perfilAtual = { ...(perfilAtual as object), guardado: 3200 };

    const v2 = await api.chamar('ana', 'post', '/planos', { sessao: ana.sessao, status: 201 });
    expect(v2.headers.location).toBe('/api/v1/planos/2');
    expect(v2.body).toMatchObject({ versao: 2, entrada: perfilAtual });

    const atual = await api.chamar('ana', 'get', '/planos/atual', { sessao: ana.sessao, status: 200 });
    expect(atual.body.versao).toBe(2);
    const historico = await api.chamar('ana', 'get', '/planos', { sessao: ana.sessao, status: 200 });
    expect(historico.body.items.map((i: { versao: number }) => i.versao)).toEqual([2, 1]);
    expect(historico.body.nextCursor).toBeNull();
    const v1 = await api.chamar('ana', 'get', '/planos/1', { sessao: ana.sessao, status: 200 });
    expect(v1.body.entrada.guardado).toBe(2500.5);
  });

  await passo('meta: criar, publicar e ver a página pública sem token e sem valores em reais', async () => {
    const criada = await api.chamar('ana', 'post', '/metas', {
      sessao: ana.sessao,
      corpo: { nome: 'Reserva de emergência', valorAlvo: 15000, aporteMensal: 600, acumulado: 3000 },
      status: 201,
    });
    expect(criada.headers.location).toBe(`/api/v1/metas/${criada.body.id}`);
    expect(criada.body).toMatchObject({ progresso: 0.2, atingida: false, publicSlug: null });
    expect(criada.body.projecao.mesesEstimados).toEqual(expect.any(Number));

    // aporte e prazo juntos é regra de negócio
    await api.chamar('ana', 'post', '/metas', {
      sessao: ana.sessao,
      corpo: { nome: 'X', valorAlvo: 100, aporteMensal: 10, prazoMeses: 10 },
      status: 422,
    });

    const publicada = await api.chamar('ana', 'post', `/metas/${criada.body.id}/publicar`, { sessao: ana.sessao, status: 200 });
    expect(publicada.body.publicSlug).toMatch(/^[a-z0-9-]+$/);
    const denovo = await api.chamar('ana', 'post', `/metas/${criada.body.id}/publicar`, { sessao: ana.sessao, status: 200 });
    expect(denovo.body.publicSlug).toBe(publicada.body.publicSlug);
    metaDaAna = { id: criada.body.id, slug: publicada.body.publicSlug };

    await api.chamar('ana', 'patch', `/metas/${metaDaAna.id}`, { sessao: ana.sessao, corpo: { acumulado: 3750 }, status: 200 });

    const publica = await api.chamar('anonimo', 'get', `/metas/publicas/${metaDaAna.slug}`, { status: 200 });
    expect(publica.headers['cache-control']).toBe('public, max-age=300');
    expect(publica.body).toEqual({ nome: 'Reserva de emergência', progresso: 0.25, atingida: false });
    for (const reais of ['15000', '3750', '600']) expect(publica.text).not.toContain(reais);

    const lista = await api.chamar('ana', 'get', '/metas', { sessao: ana.sessao, status: 200 });
    expect(lista.body.items).toHaveLength(1);
  });

  await passo('Bruno entra no meio, monta o perfil, gera plano e cria meta', async () => {
    bruno = await entrar('bruno', 'bruno@exemplo.com.br');
    expect(bruno.id).not.toBe(ana.id);
    const perfil = await api.chamar('bruno', 'put', '/perfil/completo', { sessao: bruno.sessao, corpo: PERFIL_DO_BRUNO, status: 200 });
    expect(perfil.body).toEqual(PERFIL_DO_BRUNO);
    const plano = await api.chamar('bruno', 'post', '/planos', { sessao: bruno.sessao, status: 201 });
    expect(plano.body.versao).toBe(1);
    await api.chamar('bruno', 'post', '/metas', {
      sessao: bruno.sessao,
      corpo: { nome: 'Notebook', valorAlvo: 4500, prazoMeses: 10 },
      status: 201,
    });
    const categorias = await api.chamar('bruno', 'get', '/categorias', { sessao: bruno.sessao, status: 200 });
    expect(categorias.body.items).toHaveLength(24);
  });

  await passo('Bruno não enxerga nem mexe em nada da Ana (404, igual a inexistente)', async () => {
    const s = bruno.sessao;
    await api.chamar('bruno', 'get', `/metas/${metaDaAna.id}`, { sessao: s, status: 404 });
    await api.chamar('bruno', 'post', `/metas/${metaDaAna.id}/publicar`, { sessao: s, status: 404 });
    await api.chamar('bruno', 'delete', `/metas/${metaDaAna.id}`, { sessao: s, status: 404 });
    await api.chamar('bruno', 'patch', `/perfil/gastos-fixos/${idsDosGastos.mercado}`, { sessao: s, corpo: { valor: 1 }, status: 404 });
    await api.chamar('bruno', 'delete', `/perfil/dividas/${idDaDividaDaAna}`, { sessao: s, status: 404 });
    await api.chamar('bruno', 'get', '/planos/2', { sessao: s, status: 404 });

    const daAna = await api.chamar('ana', 'get', '/perfil/completo', { sessao: ana.sessao, status: 200 });
    expect(daAna.body).toEqual(perfilAtual);
    const metas = await api.chamar('ana', 'get', '/metas', { sessao: ana.sessao, status: 200 });
    expect(metas.body.items).toHaveLength(1);
  });

  await passo('PUT /check-ins do mês anterior compara com a versão que valia naquele mês', async () => {
    /*
      A Ana se cadastrou em setembro: quando agosto aconteceu, nenhuma das versões
      dela existia ainda (todas nascem em 2026-09-17, depois de
      fimDaCompetencia('2026-08') = 2026-09-01T03:00Z). findEmVigorEm cai no
      fallback e compara com a MAIS ANTIGA — a versão 1 —, em vez de deixar a
      pessoa sem comparação nenhuma.
    */
    const plano = planoV1!;
    const res = await api.chamar('ana', 'put', '/check-ins/2026-08', {
      sessao: ana.sessao,
      corpo: { rendaReal: 4800, gastoReal: 3350.4, guardadoReal: 700 },
      status: 200,
    });
    const diferenca = Number((700 - plano.resultado.aporte).toFixed(2)) || 0;
    expect(res.body).toMatchObject({
      competencia: '2026-08',
      rendaReal: 4800,
      gastoReal: 3350.4,
      guardadoReal: 700,
      respondidoEm: clock.now().toISOString(),
      enviadoEm: null,
      comparacao: {
        aportePlanejado: plano.resultado.aporte,
        livrePlanejado: plano.resultado.livre,
        guardadoReal: 700,
        diferenca,
        cumpriu: diferenca >= 0,
        versaoDoPlano: 1,
      },
    });
    checkInDeAgosto = res.body;

    await api.chamar('ana', 'put', '/check-ins/2026-10', {
      sessao: ana.sessao,
      corpo: { rendaReal: 1, gastoReal: 1, guardadoReal: 1 },
      status: 400,
    });
    const obtido = await api.chamar('ana', 'get', '/check-ins/2026-08', { sessao: ana.sessao, status: 200 });
    expect(obtido.body).toEqual(res.body);
    const lista = await api.chamar('ana', 'get', '/check-ins', { sessao: ana.sessao, status: 200 });
    expect(lista.body.items.map((c: { competencia: string }) => c.competencia)).toEqual(['2026-08']);
  });

  await passo('salário bruto, dependentes, ritmo e meta atravessam o perfil e chegam no plano', async () => {
    /*
      O teste que fecha a malha da seção E da especificação: os campos novos
      passam pelo schema HTTP, pela entidade, pelo mapper, pelo presenter e pelo
      inputSnap do plano. Cada um desses arquivos copia campo a campo, e um
      esquecimento ali não dá erro de compilação — só some com a resposta da
      pessoa. `rendaMensal` continua sendo o LÍQUIDO: o bruto é registro, o
      servidor nunca recalcula o líquido a partir dele.
    */
    perfilComRitmo = {
      ...(perfilAtual as object),
      rendaInformada: 'bruta',
      salarioBruto: 6000,
      dependentes: 1,
      competenciaTabela: '2026-01',
      ritmo: 'acelerado',
      // tipo do catálogo: sem `nome`, e a chave tem que continuar ausente na volta
      meta: { tipo: 'carro', valorAlvo: 45000 },
    };

    const salvo = await api.chamar('ana', 'put', '/perfil/completo', {
      sessao: ana.sessao,
      corpo: perfilComRitmo as object,
      status: 200,
    });
    expect(salvo.body).toEqual(perfilComRitmo);

    // o round-trip inteiro: o que volta do GET é o corpo do próximo PUT
    const completo = await api.chamar('ana', 'get', '/perfil/completo', { sessao: ana.sessao, status: 200 });
    expect(completo.body).toEqual(perfilComRitmo);
    const escalares = await api.chamar('ana', 'get', '/perfil', { sessao: ana.sessao, status: 200 });
    expect(escalares.body).toMatchObject({
      rendaMensal: 4800,
      rendaInformada: 'bruta',
      salarioBruto: 6000,
      dependentes: 1,
      competenciaTabela: '2026-01',
      ritmo: 'acelerado',
      meta: { tipo: 'carro', valorAlvo: 45000 },
    });
    expect(escalares.body.meta).not.toHaveProperty('nome');

    const v3 = await api.chamar('ana', 'post', '/planos', { sessao: ana.sessao, status: 201 });
    expect(v3.headers.location).toBe('/api/v1/planos/3');
    expect(v3.body).toMatchObject({ versao: 3, entrada: perfilComRitmo });
    // o ritmo chegou no motor: o plano diz com qual ritmo foi calculado…
    expect(v3.body.resultado.ritmo).toBe('acelerado');
    /*
      …e o aporte é a fatia do acelerado neste degrau, limitada pelo piso. A
      conta é feita com a tabela do motor (PROPORCAO_APORTE) e com o `piso` que o
      próprio plano publica, não com um número escrito à mão: quando o produto
      reajustar a proporção do acelerado, este passo continua provando a mesma
      coisa — que o ritmo do perfil é o que decide o aporte — em vez de virar um
      literal pra alguém atualizar no escuro.
    */
    const { degrau, resumo, aporte, piso } = v3.body.resultado;
    expect(degrau).toBe(1);
    expect(piso.sugerido).toBe(arredondar(resumo.excedente * PROPORCAO_APORTE.acelerado[degrau as 0 | 1 | 2 | 3 | 4]));
    expect(aporte).toBe(arredondar(Math.min(piso.sugerido, piso.teto)));

    /*
      E o ritmo é entrada de verdade, não enfeite: o MESMO perfil no leve guarda
      menos. Vai pela calculadora pública, que não grava versão nenhuma.
    */
    const noLeve = await api.chamar('anonimo', 'post', '/planos/simular', {
      corpo: { ...(perfilComRitmo as object), ritmo: 'leve' },
      status: 200,
    });
    expect(noLeve.body.resultado.ritmo).toBe('leve');
    expect(noLeve.body.resultado.aporte).toBe(
      arredondar(resumo.excedente * PROPORCAO_APORTE.leve[degrau as 0 | 1 | 2 | 3 | 4]),
    );
    expect(noLeve.body.resultado.aporte).toBeLessThan(aporte);

    /*
      E o valor escolhido a dedo — a pessoa editando o grupo "Guardar" — vence o
      ritmo, inclusive nas projeções. É o caminho mais fácil de quebrar em
      silêncio: são sete listas campo a campo entre o corpo do PATCH e o motor,
      e o campo é opcional, então nenhuma delas quebra a compilação se esquecer.
    */
    const escolhido = arredondar(aporte + 100);
    const comEscolha = await api.chamar('ana', 'patch', '/perfil', {
      sessao: ana.sessao,
      corpo: { aporteEscolhido: escolhido },
      status: 200,
    });
    expect(comEscolha.body.aporteEscolhido).toBe(escolhido);

    const v4 = await api.chamar('ana', 'post', '/planos', { sessao: ana.sessao, status: 201 });
    expect(v4.body.entrada.aporteEscolhido).toBe(escolhido);
    expect(v4.body.resultado.aporte).toBe(escolhido);
    expect(v4.body.resultado.livre).toBe(arredondar(resumo.excedente - escolhido));
    // o piso do ritmo não limita uma escolha explícita: quem avisa é a tela
    expect(v4.body.resultado.piso.mordeu).toBe(false);
  });

  await passo('plano novo não reescreve o passado: o check-in de agosto continua igual', async () => {
    /*
      A regressão que a seção D conserta: a comparação usava sempre a versão mais
      nova, então trocar o ritmo em setembro mudava o veredito de agosto de
      "cumpriu" pra "não cumpriu". Agora já existem a versão 3 (o ritmo) e a 4 (o
      aporte escolhido a dedo), e agosto continua comparando com a versão 1 —
      byte a byte o mesmo corpo.
    */
    const relido = await api.chamar('ana', 'get', '/check-ins/2026-08', { sessao: ana.sessao, status: 200 });
    expect(relido.body).toEqual(checkInDeAgosto);
    expect(relido.body.comparacao.versaoDoPlano).toBe(1);

    const atual = await api.chamar('ana', 'get', '/planos/atual', { sessao: ana.sessao, status: 200 });
    expect(atual.body.versao).toBe(4);
  });

  await passo('PUT /organizacao guarda a árvore de grupos, e o PUT seguinte substitui ela inteira', async () => {
    /*
      O grupo "Guardar" é o do sistema: nasce com o valor do aporte do plano e é
      editável — é assim que o ritmo e os grupos viram o MESMO controle. O valor
      vem do plano atual, não de um literal: o que este passo prova é o
      round-trip da árvore, e um número colado aqui só envelheceria.
    */
    const plano = await api.chamar('ana', 'get', '/planos/atual', { sessao: ana.sessao, status: 200 });
    const arvore = {
      grupos: [
        {
          id: 'grupo-guardar',
          nome: 'Guardar',
          icone: 'PiggyBank',
          valor: plano.body.resultado.aporte as number,
          contaParaMeta: true,
          doSistema: true,
          itens: [],
        },
        {
          id: 'grupo-namoro',
          nome: 'Namoro',
          icone: 'Heart',
          valor: 400,
          contaParaMeta: false,
          rendimentoMensal: 0.008,
          doSistema: false,
          itens: [
            { id: 'item-presente', nome: 'Presente', valor: 150 },
            { id: 'item-ferias', nome: 'Férias', valor: 200 },
          ],
        },
      ],
    };

    const vazia = await api.chamar('ana', 'get', '/organizacao', { sessao: ana.sessao, status: 200 });
    expect(vazia.headers['cache-control']).toBe('private, no-store');
    expect(vazia.body).toEqual({ grupos: [] });

    const salva = await api.chamar('ana', 'put', '/organizacao', { sessao: ana.sessao, corpo: arvore, status: 200 });
    // o corpo da resposta é EXATAMENTE o corpo do próximo PUT: é isso que faz a
    // cópia do servidor e a do localStorage não divergirem
    expect(salva.body).toEqual(arvore);
    const lida = await api.chamar('ana', 'get', '/organizacao', { sessao: ana.sessao, status: 200 });
    expect(lida.body).toEqual(arvore);

    // substituir a árvore inteira: o grupo que não veio some, com os itens dele
    const menor = { grupos: [{ ...arvore.grupos[1], valor: 300, itens: [arvore.grupos[1]!.itens[0]] }] };
    const trocada = await api.chamar('ana', 'put', '/organizacao', { sessao: ana.sessao, corpo: menor, status: 200 });
    expect(trocada.body).toEqual(menor);
    expect((await api.chamar('ana', 'get', '/organizacao', { sessao: ana.sessao, status: 200 })).body).toEqual(menor);

    // a árvore é de quem organizou: o Bruno tem a dele, vazia até ele organizar
    const doBruno = await api.chamar('bruno', 'get', '/organizacao', { sessao: bruno.sessao, status: 200 });
    expect(doBruno.body).toEqual({ grupos: [] });
    // PJ: a especificação sugere justamente o grupo "Imposto" pra quem não tem bruto
    const arvoreDoBruno = {
      grupos: [
        {
          id: 'grupo-imposto',
          nome: 'Imposto',
          icone: 'Receipt',
          valor: 520,
          contaParaMeta: false,
          doSistema: false,
          itens: [{ id: 'item-das', nome: 'DAS', valor: 520 }],
        },
      ],
    };
    await api.chamar('bruno', 'put', '/organizacao', { sessao: bruno.sessao, corpo: arvoreDoBruno, status: 200 });
    expect((await api.chamar('ana', 'get', '/organizacao', { sessao: ana.sessao, status: 200 })).body).toEqual(menor);

    await api.chamar('anonimo', 'get', '/organizacao', { status: 401 });
    // id repetido no mesmo corpo é 400 por caminho, não "o último vence"
    const repetido = await api.chamar('ana', 'put', '/organizacao', {
      sessao: ana.sessao,
      corpo: { grupos: [menor.grupos[0], { ...menor.grupos[0], nome: 'Outro' }] },
      status: 400,
    });
    expect(repetido.body.error.details).toHaveProperty('grupos.1.id');
    expect((await api.chamar('ana', 'get', '/organizacao', { sessao: ana.sessao, status: 200 })).body).toEqual(menor);
  });

  await passo('job do dia 1 abre setembro e manda o e-mail com descadastro no fragmento; rodar de novo não duplica', async () => {
    // 00:30 do dia 1 em São Paulo
    clock.set('2026-10-01T03:30:00.000Z');
    const job = createJobs(amb.container).abrirCheckIns;
    const antes = mailer.sent.length;

    const relatorio = await job.execute();
    expect(relatorio).toEqual({ competencia: '2026-09', abertos: 2, jaExistiam: 0, enviados: 2, jaEnviados: 0, falhas: 0 });

    const enviados = mailer.sent.slice(antes);
    expect(enviados.map((m) => m.to).sort()).toEqual([ana.email, bruno.email].sort());
    const paraAna = enviados.find((m) => m.to === ana.email)!;
    expect(paraAna.subject).toBe('Como foi setembro com o seu dinheiro?');
    expect(paraAna.text).toContain(`${APP_URL_E2E}/check-in/2026-09`);
    tokenDescadastro = tokenNoFragmento(paraAna.text, '/descadastrar');
    expect(paraAna.html).not.toMatch(/[?&]token=/);

    const denovo = await job.execute();
    expect(denovo).toEqual({ competencia: '2026-09', abertos: 0, jaExistiam: 2, enviados: 0, jaEnviados: 2, falhas: 0 });
    expect(mailer.sent.length).toBe(antes + 2);

    const setembro = await api.chamar('ana', 'get', '/check-ins/2026-09', { sessao: ana.sessao, status: 200 });
    expect(setembro.body).toMatchObject({ enviadoEm: '2026-10-01T03:30:00.000Z', respondidoEm: null, guardadoReal: null });
  });

  await passo('descadastro pelo link do e-mail: sessão não serve como token; o do e-mail vale e é idempotente', async () => {
    await api.chamar('anonimo', 'post', '/descadastrar', { corpo: { token: ana.sessao }, status: 401 });
    await api.chamar('anonimo', 'post', '/descadastrar', { corpo: { token: tokenDescadastro }, status: 204 });
    await api.chamar('anonimo', 'post', '/descadastrar', { corpo: { token: tokenDescadastro }, status: 204 });

    // descadastro para o e-mail mas não encerra a sessão
    const me = await api.chamar('ana', 'get', '/me', { sessao: ana.sessao, status: 200 });
    expect(me.body).toMatchObject({ id: ana.id, ativo: false, emailVerificadoEm: expect.any(String) });
    const doBruno = await api.chamar('bruno', 'get', '/me', { sessao: bruno.sessao, status: 200 });
    expect(doBruno.body.ativo).toBe(true);
  });

  await passo('GET /me/exportar traz tudo da Ana e nada do Bruno', async () => {
    const res = await api.chamar('ana', 'get', '/me/exportar', { sessao: ana.sessao, status: 200 });
    expect(res.headers['content-disposition']).toBe('attachment; filename="dindin-meus-dados-2026-10-01.json"');
    expect(res.headers['cache-control']).toBe('no-store');
    const dados = res.body;

    expect(dados.conta).toMatchObject({ email: ana.email, ativo: false, emailVerificadoEm: expect.any(String) });
    // a exportação leva as respostas NOVAS do perfil também: sem elas o arquivo
    // da LGPD sai incompleto e nenhum outro teste fica vermelho
    expect(dados.perfil).toMatchObject({
      rendaMensal: 4800,
      tipoRenda: 'clt',
      guardado: 3200,
      rendaInformada: 'bruta',
      salarioBruto: 6000,
      dependentes: 1,
      competenciaTabela: '2026-01',
      ritmo: 'acelerado',
      meta: { tipo: 'carro', valorAlvo: 45000 },
    });
    expect(dados.gastosFixos.map((g: { categoria: string; valor: number }) => [g.categoria, g.valor]).sort()).toEqual(
      [
        ['Academia', 119.9],
        ['Clube', 105.5],
        ['Luz', 165.4],
        ['Mercado', 700],
        ['Streaming e assinaturas', 55.9],
      ].sort(),
    );
    expect(dados.categoriasPersonalizadas.map((c: { nome: string }) => c.nome)).toEqual(['Clube']);
    expect(dados.dividas.map((d: { tipo: string; saldo: number }) => [d.tipo, d.saldo]).sort()).toEqual(
      [
        ['emprestimo', 5800],
        ['rotativo', 1800],
      ].sort(),
    );
    expect(dados.planos.map((p: { versao: number }) => p.versao).sort()).toEqual([1, 2, 3, 4]);
    expect(dados.planos.find((p: { versao: number }) => p.versao === 2).entrada).toEqual(perfilAtual);
    expect(dados.planos.find((p: { versao: number }) => p.versao === 3).entrada).toEqual(perfilComRitmo);
    expect(dados.metas).toEqual([
      expect.objectContaining({ nome: 'Reserva de emergência', valorAlvo: 15000, acumulado: 3750, publicSlug: metaDaAna.slug }),
    ]);
    expect(dados.checkIns.map((c: { competencia: string }) => c.competencia).sort()).toEqual(['2026-08', '2026-09']);
    // a árvore do excedente entra no arquivo, com os itens dentro do grupo e sem
    // os ids (que são chave, não informação)
    expect(dados.grupos).toEqual([
      {
        nome: 'Namoro',
        icone: 'Heart',
        valor: 300,
        contaParaMeta: false,
        rendimentoMensal: 0.008,
        doSistema: false,
        criadoEm: expect.any(String),
        itens: [{ nome: 'Presente', valor: 150 }],
      },
    ]);

    expect(res.text).not.toContain(bruno.email);
    expect(res.text).not.toContain('Notebook');
    // nada da organização do Bruno
    expect(res.text).not.toContain('Imposto');
  });

  await passo('DELETE /me exige a confirmação; com ela apaga, e a mesma sessão passa a dar 401', async () => {
    const semCorpo = await api.chamar('ana', 'delete', '/me', { sessao: ana.sessao, status: 400 });
    expect(semCorpo.body.error.details).toHaveProperty('confirmacao');
    await api.chamar('ana', 'delete', '/me', { sessao: ana.sessao, corpo: { confirmacao: 'excluir' }, status: 400 });
    await api.chamar('ana', 'get', '/me', { sessao: ana.sessao, status: 200 });

    await api.chamar('ana', 'delete', '/me', { sessao: ana.sessao, corpo: { confirmacao: 'EXCLUIR' }, status: 204 });

    for (const [metodo, caminho] of [
      ['get', '/me'],
      ['get', '/perfil/completo'],
      ['get', '/me/exportar'],
      ['post', '/planos'],
      ['get', '/metas'],
      ['get', '/organizacao'],
    ] as const) {
      const res = await api.chamar('ana', metodo, caminho, { sessao: ana.sessao, status: 401 });
      expect(res.body.error.code).toBe('NAO_AUTENTICADO');
    }
    // nem recriar dados com a sessão antiga
    await api.chamar('ana', 'put', '/perfil/completo', { sessao: ana.sessao, corpo: PERFIL_DA_ANA, status: 401 });
    // a meta pública saiu do ar junto
    await api.chamar('anonimo', 'get', `/metas/publicas/${metaDaAna.slug}`, { status: 404 });

    expect(await retratoDaConta(r, ana.id)).toEqual(CONTA_INEXISTENTE);
  });

  await passo('Bruno continua intacto', async () => {
    const s = bruno.sessao;
    const me = await api.chamar('bruno', 'get', '/me', { sessao: s, status: 200 });
    expect(me.body).toMatchObject({ id: bruno.id, email: bruno.email, ativo: true });
    const perfil = await api.chamar('bruno', 'get', '/perfil/completo', { sessao: s, status: 200 });
    expect(perfil.body).toEqual(PERFIL_DO_BRUNO);
    const plano = await api.chamar('bruno', 'get', '/planos/atual', { sessao: s, status: 200 });
    expect(plano.body.versao).toBe(1);
    const metas = await api.chamar('bruno', 'get', '/metas', { sessao: s, status: 200 });
    expect(metas.body.items.map((m: { nome: string }) => m.nome)).toEqual(['Notebook']);
    const checkIns = await api.chamar('bruno', 'get', '/check-ins', { sessao: s, status: 200 });
    expect(checkIns.body.items).toEqual([expect.objectContaining({ competencia: '2026-09', enviadoEm: '2026-10-01T03:30:00.000Z' })]);
    // a exclusão da Ana não levou a árvore de grupos do Bruno junto
    const organizacao = await api.chamar('bruno', 'get', '/organizacao', { sessao: s, status: 200 });
    expect(organizacao.body.grupos.map((g: { nome: string }) => g.nome)).toEqual(['Imposto']);

    expect(await retratoDaConta(r, bruno.id)).toEqual({
      conta: true,
      perfil: true,
      gastosFixos: 2,
      dividas: 0,
      planos: 1,
      metas: 1,
      checkIns: 1,
      categoriasPersonalizadas: 0,
      grupos: 1,
      itensDeGrupo: 1,
    });
  });

  await passo('nenhuma resposta vazou id de outra pessoa, hash de token ou campo interno', async () => {
    const hashes = tokensMagicos.map((t) => amb.container.services.secureTokens.hash(t));
    const vazamentos: string[] = [];
    for (const resposta of api.respostas) {
      const onde = `${resposta.ator} ${resposta.rota} (${resposta.status})`;
      const outros = resposta.ator === 'ana' ? [bruno.id] : resposta.ator === 'bruno' ? [ana.id] : [ana.id, bruno.id];
      for (const id of outros) if (resposta.texto.includes(id)) vazamentos.push(`${onde}: id de outra pessoa`);
      for (const segredo of [...hashes, ...tokensMagicos]) {
        if (resposta.texto.includes(segredo)) vazamentos.push(`${onde}: token do link mágico ou hash`);
      }
      if (resposta.texto.includes('consumido:')) vazamentos.push(`${onde}: valor interno da coluna token`);
      const chaves = chavesDoJson(resposta.corpo);
      for (const campo of CAMPOS_QUE_NUNCA_SAEM) if (chaves.has(campo)) vazamentos.push(`${onde}: campo "${campo}"`);
    }
    expect(vazamentos).toEqual([]);
    expect(amb.errosInesperados).toEqual([]);
  });

  return { ana, bruno, passos, requisicoes: api.respostas.length };
}
