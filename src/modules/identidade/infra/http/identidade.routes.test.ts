import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { createIdentidadeModule } from '../../infra';
import { InMemorySubscribersRepository } from '../database/in-memory-subscribers-repository';

let kit: TestKit;
let app: ReturnType<TestKit['app']>;
let subscribers: InMemorySubscribersRepository;

const MINUTO = 60_000;
const MENSAGEM = 'Se esse e-mail puder entrar, o link chega em instantes.';
const LINK_INVALIDO = 'Esse link expirou ou já foi usado. Peça um novo.';

function montar({ rateLimit }: { rateLimit: boolean }) {
  return kit.app((api) =>
    api.use(
      createIdentidadeModule({
        ...kit.deps,
        subscribers,
        secureTokens: kit.secureTokens,
        authTokens: kit.authTokens,
        mailer: kit.mailer,
        config: { appUrl: 'https://dindin.test', magicLinkTtlMinutes: 15, linkResendCooldownSeconds: 60 },
        rateLimit: { enabled: rateLimit },
      }).router,
    ),
  );
}

beforeEach(() => {
  kit = createTestKit();
  subscribers = new InMemorySubscribersRepository();
  app = montar({ rateLimit: false });
});

// cada teste com o seu kit: um 500 escondido falha o próprio teste que o causou
afterEach(() => {
  expect(kit.unexpectedErrors).toEqual([]);
});

const pedirLink = (email: unknown) => request(app).post('/api/v1/auth/link-magico').send({ email });
const verificar = (token: unknown) => request(app).post('/api/v1/auth/verificar').send({ token });

function tokenDoUltimoEmail(): string {
  const achado = /#token=([^\s"<]+)/.exec(kit.mailer.last()?.text ?? '');
  if (!achado?.[1]) throw new Error('nenhum e-mail com link mágico');
  return decodeURIComponent(achado[1]);
}

/** pede o link, pega o token do e-mail e entra */
async function entrar(email: string): Promise<{ id: string; bearer: string }> {
  await pedirLink(email).expect(202);
  const { body } = await verificar(tokenDoUltimoEmail()).expect(200);
  return { id: body.subscriber.id, bearer: `Bearer ${body.accessToken}` };
}

describe('POST /api/v1/auth/link-magico', () => {
  it('202 com a mensagem neutra; o link vai no fragmento, nunca na query', async () => {
    const res = await pedirLink('  Pessoa@Exemplo.COM ').expect(202);

    expect(res.body).toEqual({ message: MENSAGEM });
    const email = kit.mailer.last();
    expect(email?.to).toBe('pessoa@exemplo.com');
    expect(email?.subject).toBe('Seu link pra entrar no dindin');
    expect(email?.text).toContain('https://dindin.test/entrar#token=');
    expect(email?.text).not.toMatch(/[?&]token=/);
  });

  it('reenvio dentro do intervalo mínimo: não manda segundo e-mail, mas responde 202 igual', async () => {
    const primeiro = await pedirLink('a@x.dev').expect(202);
    kit.clock.advance(30_000);
    const segundo = await pedirLink('a@x.dev').expect(202);

    expect(segundo.body).toEqual(primeiro.body);
    expect(kit.mailer.sent).toHaveLength(1);

    kit.clock.advance(30_000);
    await pedirLink('a@x.dev').expect(202);
    expect(kit.mailer.sent).toHaveLength(2);
  });

  it('e-mail novo e conta existente recebem a mesma resposta', async () => {
    const novo = await pedirLink('novo@x.dev').expect(202);
    await entrar('existente@x.dev');
    const existente = await pedirLink('existente@x.dev').expect(202);
    expect(existente.body).toEqual(novo.body);
  });

  it('e-mail inválido → 400 com detalhe do campo, sem enviar nada', async () => {
    const res = await pedirLink('sem-arroba').expect(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDACAO', details: { email: 'Informe um e-mail válido' } });
    expect(kit.mailer.sent).toHaveLength(0);
  });

  it('e-mail ausente ou de outro tipo → 400', async () => {
    const semCampo = await request(app).post('/api/v1/auth/link-magico').send({}).expect(400);
    expect(semCampo.body.error.details).toHaveProperty('email');
    await pedirLink(123).expect(400);
    await pedirLink(`${'x'.repeat(320)}@x.dev`).expect(400);
  });

  it('falha no envio → 500 genérico, e a próxima tentativa envia sem esperar o intervalo', async () => {
    kit.mailer.failNext = true;
    const res = await pedirLink('a@x.dev').expect(500);
    expect(res.body.error.code).toBe('ERRO_INTERNO');
    expect(kit.unexpectedErrors).toHaveLength(1);
    // esperado neste teste: não conta como erro escondido
    kit.unexpectedErrors.splice(0);

    await pedirLink('a@x.dev').expect(202);
    expect(kit.mailer.sent).toHaveLength(1);
    await verificar(tokenDoUltimoEmail()).expect(200);
  });

  it('limite por IP: a 6ª tentativa em 15 minutos → 429, sem afetar a verificação', async () => {
    app = montar({ rateLimit: true });
    for (let i = 0; i < 5; i++) await pedirLink(`pessoa${i}@x.dev`).expect(202);

    const res = await pedirLink('mais-uma@x.dev').expect(429);
    expect(res.body.error.code).toBe('MUITAS_REQUISICOES');
    expect(kit.mailer.sent).toHaveLength(5);
    // contador próprio por rota
    await verificar('qualquer').expect(401);
  });
});

describe('POST /api/v1/auth/verificar', () => {
  it('fluxo completo: pedir link → verificar → usar a sessão em GET /me', async () => {
    await pedirLink('a@x.dev').expect(202);
    kit.clock.advance(5 * MINUTO);

    const res = await verificar(tokenDoUltimoEmail()).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      expiresAt: '2026-10-17T12:05:00.000Z',
      subscriber: { id: 'id-1', email: 'a@x.dev', emailVerificadoEm: '2026-09-17T12:05:00.000Z', ativo: true },
    });

    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body).toEqual({
      id: 'id-1',
      email: 'a@x.dev',
      emailVerificadoEm: '2026-09-17T12:05:00.000Z',
      ativo: true,
      criadoEm: '2026-09-17T12:00:00.000Z',
    });
  });

  it('segundo verificar com o mesmo token → 401', async () => {
    await pedirLink('a@x.dev').expect(202);
    const token = tokenDoUltimoEmail();
    await verificar(token).expect(200);

    const res = await verificar(token).expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: LINK_INVALIDO });
  });

  it('link vencido → 401 e o e-mail continua sem confirmação', async () => {
    await pedirLink('a@x.dev').expect(202);
    kit.clock.advance(15 * MINUTO + 1);

    const res = await verificar(tokenDoUltimoEmail()).expect(401);
    expect(res.body.error.message).toBe(LINK_INVALIDO);
    expect((await subscribers.findByEmail('a@x.dev'))?.emailVerificadoEm).toBeNull();
  });

  it('link substituído por um novo → o antigo responde 401', async () => {
    await pedirLink('a@x.dev').expect(202);
    const antigo = tokenDoUltimoEmail();
    kit.clock.advance(MINUTO);
    await pedirLink('a@x.dev').expect(202);

    await verificar(antigo).expect(401);
    await verificar(tokenDoUltimoEmail()).expect(200);
  });

  it('token que nunca existiu → 401; ausente ou vazio → 400', async () => {
    await verificar('inventado').expect(401);
    await request(app).post('/api/v1/auth/verificar').send({}).expect(400);
    await verificar('').expect(400);
  });
});

describe('GET /api/v1/me', () => {
  it('devolve só a conta da sessão, sem campo interno', async () => {
    const a = await entrar('a@x.dev');
    await entrar('b@x.dev');

    const res = await request(app).get('/api/v1/me').set('Authorization', a.bearer).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.email).toBe('a@x.dev');
    expect(Object.keys(res.body).sort()).toEqual(['ativo', 'criadoEm', 'email', 'emailVerificadoEm', 'id']);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|consumido|token/i);
  });

  it('sem token → 401', async () => {
    const res = await request(app).get('/api/v1/me').expect(401);
    expect(res.body.error.code).toBe('NAO_AUTENTICADO');
  });

  it('sessão de uma conta que não está mais no cadastro → 404', async () => {
    const res = await request(app).get('/api/v1/me').set('Authorization', kit.bearer('nao-existe')).expect(404);
    expect(res.body.error.code).toBe('NAO_ENCONTRADO');
  });

  it('conta excluída: a sessão deixa de valer → 401', async () => {
    const a = await entrar('a@x.dev');
    kit.sessionAccounts.markDeleted(a.id);
    await request(app).get('/api/v1/me').set('Authorization', a.bearer).expect(401);
  });
});

describe('POST /api/v1/me/descadastrar e /me/reativar', () => {
  it('descadastra (200, ativo=false) e reativa (200, ativo=true), gravando', async () => {
    const a = await entrar('a@x.dev');

    const fora = await request(app).post('/api/v1/me/descadastrar').set('Authorization', a.bearer).expect(200);
    expect(fora.body).toMatchObject({ id: a.id, email: 'a@x.dev', ativo: false });
    expect((await subscribers.findById(a.id))?.ativo).toBe(false);

    const dentro = await request(app).post('/api/v1/me/reativar').set('Authorization', a.bearer).expect(200);
    expect(dentro.body).toMatchObject({ id: a.id, ativo: true });
    expect((await subscribers.findById(a.id))?.ativo).toBe(true);
  });

  it('id de outra pessoa no corpo é ignorado: só a conta da sessão muda', async () => {
    const a = await entrar('a@x.dev');
    const b = await entrar('b@x.dev');

    await request(app)
      .post('/api/v1/me/descadastrar')
      .set('Authorization', a.bearer)
      .send({ subscriberId: b.id, id: b.id })
      .expect(200);
    expect((await subscribers.findById(a.id))?.ativo).toBe(false);
    expect((await subscribers.findById(b.id))?.ativo).toBe(true);
  });

  it('descadastro não encerra a sessão nem impede de pedir link', async () => {
    const a = await entrar('a@x.dev');
    await request(app).post('/api/v1/me/descadastrar').set('Authorization', a.bearer).expect(200);

    await request(app).get('/api/v1/me').set('Authorization', a.bearer).expect(200);
    await pedirLink('a@x.dev').expect(202);
    expect(kit.mailer.sent).toHaveLength(2);
  });

  it.each(['/api/v1/me/descadastrar', '/api/v1/me/reativar'])('%s sem token → 401; conta inexistente → 404', async (rota) => {
    await request(app).post(rota).expect(401);
    await request(app).post(rota).set('Authorization', kit.bearer('nao-existe')).expect(404);
  });

  it('JSON malformado → 400', async () => {
    const a = await entrar('a@x.dev');
    const res = await request(app)
      .post('/api/v1/me/descadastrar')
      .set('Authorization', a.bearer)
      .set('Content-Type', 'application/json')
      .send('{"x":')
      .expect(400);
    expect(res.body.error.code).toBe('JSON_INVALIDO');
  });
});

describe('POST /api/v1/descadastrar', () => {
  const descadastrarPorToken = (token: unknown) => request(app).post('/api/v1/descadastrar').send({ token });

  it('204 com o token do e-mail, sem sessão; repetir também responde 204', async () => {
    const a = await entrar('a@x.dev');
    const { token } = kit.authTokens.issueUnsubscribe(a.id);

    const res = await descadastrarPorToken(token).expect(204);
    expect(res.body).toEqual({});
    expect((await subscribers.findById(a.id))?.ativo).toBe(false);
    await descadastrarPorToken(token).expect(204);
  });

  it('token de conta já excluída → 204, sem confirmar nada', async () => {
    await descadastrarPorToken(kit.authTokens.issueUnsubscribe('excluida').token).expect(204);
  });

  it('token inválido ou de sessão → 401 e nada muda', async () => {
    const a = await entrar('a@x.dev');

    const lixo = await descadastrarPorToken('lixo').expect(401);
    expect(lixo.body.error.message).toBe('Link de descadastro inválido.');
    await descadastrarPorToken(kit.authTokens.issueSession(a.id).token).expect(401);
    expect((await subscribers.findById(a.id))?.ativo).toBe(true);
  });

  it('token ausente → 400', async () => {
    const res = await request(app).post('/api/v1/descadastrar').send({}).expect(400);
    expect(res.body.error.details).toHaveProperty('token');
  });
});

describe('limite por IP nas rotas que conferem token', () => {
  it.each([
    ['/api/v1/auth/verificar', 401],
    ['/api/v1/descadastrar', 401],
  ])('%s: a 21ª tentativa em 15 minutos → 429', async (rota, statusNormal) => {
    app = montar({ rateLimit: true });
    for (let i = 0; i < 20; i++) await request(app).post(rota).send({ token: `chute-${i}` }).expect(statusNormal);

    const res = await request(app).post(rota).send({ token: 'mais-um' }).expect(429);
    expect(res.body.error.code).toBe('MUITAS_REQUISICOES');
  });

  it('nenhum erro inesperado (500) aconteceu nesses fluxos', () => {
    expect(kit.unexpectedErrors).toEqual([]);
  });
});
