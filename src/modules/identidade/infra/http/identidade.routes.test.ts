import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionAccounts } from '../../../../shared/application/ports';
import { createAuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { createTestKit, type TestKit } from '../../../../test/kit';
import { Subscriber } from '../../domain/subscriber';
import { createIdentidadeModule } from '../../infra';
import { InMemorySubscribersRepository } from '../database/in-memory-subscribers-repository';

let kit: TestKit;
let app: ReturnType<TestKit['app']>;
let subscribers: InMemorySubscribersRepository;
let avisos: Array<{ mensagem: string; contexto: Record<string, unknown> }>;

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const SENHA = 'minha senha boa';
const OUTRA_SENHA = 'outra senha forte';
const MENSAGEM_ESQUECI = 'Se existir uma conta com esse e-mail, o link pra criar uma senha nova chega em instantes.';
const LINK_INVALIDO = 'Esse link expirou ou já foi usado. Peça um novo.';
const CREDENCIAIS_INVALIDAS = 'E-mail ou senha incorretos.';
const JA_CADASTRADO = 'Já existe uma conta com esse e-mail. Entre com a sua senha ou use “Esqueci a senha”.';

/*
  A sessão como o main confere — a versão das sessões lida da conta no
  repositório (a senha nova derruba as de antes) —, mais o markDeleted do kit.
  Token de uma conta que só existe no token (kit.bearer('nao-existe')) conta como
  versão 0: é assim que os testes de 404 chegam no caso de uso.
*/
const sessoesDaConta: SessionAccounts = {
  sessionVersion: async (id) => {
    if ((await kit.sessionAccounts.sessionVersion(id)) === null) return null;
    return (await subscribers.findById(id))?.versaoSessao ?? 0;
  },
};

function montar({ rateLimit }: { rateLimit: boolean }) {
  return kit.app((api) =>
    api.use(
      createIdentidadeModule({
        ...kit.deps,
        auth: createAuthMiddlewares(kit.authTokens, sessoesDaConta),
        backgroundJobs: kit.backgroundJobs,
        subscribers,
        secureTokens: kit.secureTokens,
        authTokens: kit.authTokens,
        passwords: kit.passwords,
        mailer: kit.mailer,
        config: {
          appUrl: 'https://dindin.test',
          confirmationLinkTtlHours: 48,
          resetLinkTtlMinutes: 15,
          linkResendCooldownSeconds: 60,
        },
        rateLimit: { enabled: rateLimit },
        avisos: { warn: (mensagem, contexto) => avisos.push({ mensagem, contexto }) },
      }).router,
    ),
  );
}

beforeEach(() => {
  kit = createTestKit();
  subscribers = new InMemorySubscribersRepository();
  avisos = [];
  app = montar({ rateLimit: false });
});

// cada teste com o seu kit: um 500 escondido (ou um envio que falhou em segundo plano) falha o próprio teste
afterEach(() => {
  expect(kit.unexpectedErrors).toEqual([]);
  expect(kit.backgroundFailures).toEqual([]);
});

const cadastrar = (email: unknown, senha: unknown = SENHA) =>
  request(app).post('/api/v1/auth/cadastrar').send({ email, senha });
const entrar = (email: unknown, senha: unknown = SENHA) => request(app).post('/api/v1/auth/entrar').send({ email, senha });
/** o pedido e, depois da resposta, o envio que ele agendou (a rota não espera o e-mail) */
async function esqueci(email: unknown, status: number) {
  const res = await request(app).post('/api/v1/auth/esqueci-senha').send({ email }).expect(status);
  await kit.backgroundJobs.idle();
  return res;
}
const redefinir = (token: unknown, senha: unknown = OUTRA_SENHA) =>
  request(app).post('/api/v1/auth/redefinir-senha').send({ token, senha });
const verificar = (token: unknown) => request(app).post('/api/v1/auth/verificar').send({ token });
const trocarSenha = (bearer: string, corpo: object) =>
  request(app).post('/api/v1/me/senha').set('Authorization', bearer).send(corpo);

function tokenDoUltimoEmail(caminho: '/entrar' | '/redefinir-senha'): string {
  const achado = new RegExp(`https://dindin\\.test${caminho}#token=([^\\s"<]+)`).exec(kit.mailer.last()?.text ?? '');
  if (!achado?.[1]) throw new Error(`nenhum e-mail com ${caminho}#token=`);
  return decodeURIComponent(achado[1]);
}

/** cria a conta e devolve a sessão */
async function criarConta(email: string, senha = SENHA): Promise<{ id: string; bearer: string }> {
  const { body } = await cadastrar(email, senha).expect(201);
  return { id: body.subscriber.id, bearer: `Bearer ${body.accessToken}` };
}

/** conta criada no tempo do link mágico: e-mail confirmado e nenhuma senha */
async function contaAntiga(email: string): Promise<{ id: string; bearer: string }> {
  const agora = kit.clock.now();
  const s = Subscriber.criar({ id: `antiga-${email}`, email, tokenHash: `hash-antigo-${email}`, tokenExpiraEm: agora, agora });
  s.consumirLinkMagico(agora);
  await subscribers.save(s);
  return { id: s.id, bearer: kit.bearer(s.id) };
}

describe('POST /api/v1/auth/cadastrar', () => {
  it('201 com a sessão (sem cache) e Location; manda o "Confirme seu e-mail" com o link no fragmento', async () => {
    const res = await cadastrar('  Pessoa@Exemplo.COM ').expect(201);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.location).toBe('/api/v1/me');
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      expiresAt: '2026-10-17T12:00:00.000Z',
      subscriber: { id: 'id-1', email: 'pessoa@exemplo.com', emailVerificadoEm: null, ativo: true },
    });

    const email = kit.mailer.last();
    expect(email?.to).toBe('pessoa@exemplo.com');
    expect(email?.subject).toBe('Confirme seu e-mail no dindin');
    expect(email?.text).toContain('https://dindin.test/entrar#token=');
    expect(email?.text).not.toMatch(/[?&]token=/);

    // entra na hora: a sessão já vale
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ email: 'pessoa@exemplo.com', emailVerificadoEm: null, temSenha: true });
  });

  it('a resposta nunca traz a senha nem o hash dela', async () => {
    const res = await cadastrar('a@x.dev').expect(201);
    expect(res.text).not.toContain(SENHA);
    // nenhuma chave nem valor fala de senha ou hash (o hash do dublê seria "senha(…)")
    expect(res.text).not.toMatch(/senha|hash/i);
  });

  it('e-mail que já tem conta → 409 com a mensagem pra tela no campo e-mail', async () => {
    await cadastrar('a@x.dev').expect(201);
    const res = await cadastrar('A@x.dev', OUTRA_SENHA).expect(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLITO', message: JA_CADASTRADO, details: { email: JA_CADASTRADO } });
    expect(kit.mailer.sent).toHaveLength(1);
  });

  it('e-mail inválido e senha curta → 400 com os dois campos, sem gravar nem enviar', async () => {
    const res = await cadastrar('sem-arroba', 'curta').expect(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDACAO',
      details: { email: 'Informe um e-mail válido', senha: 'A senha precisa ter pelo menos 8 caracteres.' },
    });
    expect(await subscribers.findByEmail('sem-arroba')).toBeNull();
    expect(kit.mailer.sent).toHaveLength(0);
  });

  it.each([
    ['só espaços', ' '.repeat(10), 'A senha precisa ter pelo menos 8 caracteres.'],
    ['129 caracteres', 'x'.repeat(129), 'A senha pode ter no máximo 128 caracteres.'],
    ['texto absurdo', 'x'.repeat(5000), 'A senha pode ter no máximo 128 caracteres.'],
  ])('senha com %s → 400 com a mensagem da tela', async (_caso, senha, mensagem) => {
    const res = await cadastrar('a@x.dev', senha).expect(400);
    expect(res.body.error.details).toEqual({ senha: mensagem });
  });

  it('campos ausentes ou de outro tipo → 400', async () => {
    const semSenha = await request(app).post('/api/v1/auth/cadastrar').send({ email: 'a@x.dev' }).expect(400);
    expect(semSenha.body.error.details).toEqual({ senha: 'Crie uma senha.' });
    await cadastrar('a@x.dev', 12345678).expect(400);
    await request(app).post('/api/v1/auth/cadastrar').send({ senha: SENHA }).expect(400);
    await cadastrar(`${'x'.repeat(320)}@x.dev`).expect(400);
  });

  it('a senha nunca é trimada: entra só com os espaços que tinha no cadastro', async () => {
    await cadastrar('a@x.dev', `  ${SENHA}  `).expect(201);
    await entrar('a@x.dev', SENHA).expect(401);
    await entrar('a@x.dev', `  ${SENHA}  `).expect(200);
  });

  it('falha no envio da confirmação → 201 do mesmo jeito, com um aviso no log (não é erro 500)', async () => {
    kit.mailer.failNext = true;
    const res = await cadastrar('a@x.dev').expect(201);
    expect(res.body.subscriber.email).toBe('a@x.dev');
    expect(avisos).toEqual([
      {
        mensagem: 'Conta criada, mas o e-mail de confirmação não saiu',
        contexto: { requestId: expect.any(String), erro: { name: 'Error', message: 'falha simulada de envio' } },
      },
    ]);
    await entrar('a@x.dev').expect(200);
  });

  it('limite por IP: a 11ª tentativa em 15 minutos → 429, com contador separado do entrar', async () => {
    app = montar({ rateLimit: true });
    for (let i = 0; i < 10; i++) await cadastrar(`pessoa${i}@x.dev`).expect(201);

    const res = await cadastrar('mais-uma@x.dev').expect(429);
    expect(res.body.error.code).toBe('MUITAS_REQUISICOES');
    await entrar('pessoa0@x.dev').expect(200);
  });
});

describe('POST /api/v1/auth/entrar', () => {
  beforeEach(async () => {
    await cadastrar('a@x.dev').expect(201);
  });

  it('200 com a sessão (sem cache), aceitando o e-mail com maiúscula e espaço', async () => {
    const res = await entrar('  A@X.dev ').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      expiresAt: expect.any(String),
      subscriber: { id: 'id-1', email: 'a@x.dev', emailVerificadoEm: null, ativo: true },
    });
    await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
  });

  it('senha errada, e-mail sem conta e conta sem senha → o MESMO 401', async () => {
    await contaAntiga('antiga@x.dev');
    const respostas = await Promise.all([
      entrar('a@x.dev', OUTRA_SENHA).expect(401),
      entrar('ninguem@x.dev').expect(401),
      entrar('antiga@x.dev').expect(401),
    ]);
    for (const res of respostas) {
      expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: CREDENCIAIS_INVALIDAS });
      expect(res.body.error).not.toHaveProperty('details');
    }
  });

  it('senha vazia ou e-mail inválido → 400 no campo', async () => {
    const vazia = await entrar('a@x.dev', '').expect(400);
    expect(vazia.body.error.details).toEqual({ senha: 'Informe a sua senha.' });
    const semSenha = await request(app).post('/api/v1/auth/entrar').send({ email: 'a@x.dev' }).expect(400);
    expect(semSenha.body.error.details).toEqual({ senha: 'Informe a sua senha.' });
    const email = await entrar('sem-arroba').expect(400);
    expect(email.body.error.details).toEqual({ email: 'Informe um e-mail válido' });
  });

  it('limite por IP: a 11ª tentativa em 15 minutos → 429, sem bloquear o Esqueci a senha', async () => {
    app = montar({ rateLimit: true });
    for (let i = 0; i < 10; i++) await entrar('a@x.dev', `chute-${i}-errado`).expect(401);

    const res = await entrar('a@x.dev').expect(429);
    expect(res.body.error.code).toBe('MUITAS_REQUISICOES');
    await esqueci('a@x.dev', 202);
  });
});

describe('POST /api/v1/auth/esqueci-senha', () => {
  it('202 com a mesma frase pra e-mail com e sem conta; só quem tem conta recebe o link no fragmento', async () => {
    await cadastrar('a@x.dev').expect(201);
    kit.clock.advance(MINUTO);

    const comConta = await esqueci(' A@x.dev', 202);
    const semConta = await esqueci('ninguem@x.dev', 202);
    expect(comConta.body).toEqual({ message: MENSAGEM_ESQUECI });
    expect(semConta.body).toEqual(comConta.body);

    expect(kit.mailer.sent).toHaveLength(2);
    const email = kit.mailer.last();
    expect(email?.to).toBe('a@x.dev');
    expect(email?.subject).toBe('Criar uma senha nova no dindin');
    expect(email?.text).toContain('https://dindin.test/redefinir-senha#token=');
    expect(email?.text).not.toMatch(/[?&]token=/);
  });

  it('reenvio dentro de 60 s: 202 igual, sem segundo e-mail', async () => {
    await cadastrar('a@x.dev').expect(201);
    kit.clock.advance(MINUTO);
    await esqueci('a@x.dev', 202);
    kit.clock.advance(30_000);
    await esqueci('a@x.dev', 202);
    expect(kit.mailer.sent).toHaveLength(2);

    kit.clock.advance(30_000);
    await esqueci('a@x.dev', 202);
    expect(kit.mailer.sent).toHaveLength(3);
  });

  it('e-mail inválido ou ausente → 400, sem enviar nada', async () => {
    const res = await esqueci('sem-arroba', 400);
    expect(res.body.error).toMatchObject({ code: 'VALIDACAO', details: { email: 'Informe um e-mail válido' } });
    await request(app).post('/api/v1/auth/esqueci-senha').send({}).expect(400);
    expect(kit.mailer.sent).toHaveLength(0);
  });

  it('falha no envio → o MESMO 202 (a falha vai pro log, não revela quem tem conta), e a próxima tentativa envia sem esperar o intervalo', async () => {
    await cadastrar('a@x.dev').expect(201);
    kit.clock.advance(MINUTO);
    kit.mailer.failNext = true;
    const res = await esqueci('a@x.dev', 202);
    expect(res.body).toEqual({ message: MENSAGEM_ESQUECI });
    expect(kit.backgroundFailures).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ erro: { name: 'Error', message: 'falha simulada de envio' } }) }),
    ]);
    // esperado neste teste: não conta como falha escondida
    kit.backgroundFailures.splice(0);

    await esqueci('a@x.dev', 202);
    await redefinir(tokenDoUltimoEmail('/redefinir-senha')).expect(200);
  });

  it('o 202 sai sem esperar a conta nem o e-mail: um provedor travado não segura a resposta', async () => {
    await cadastrar('a@x.dev').expect(201);
    kit.clock.advance(MINUTO);
    let envios = 0;
    kit.mailer.send = () => {
      envios++;
      return new Promise<void>(() => {});
    };
    const comConta = await request(app).post('/api/v1/auth/esqueci-senha').send({ email: 'a@x.dev' }).expect(202);
    const semConta = await request(app).post('/api/v1/auth/esqueci-senha').send({ email: 'ninguem@x.dev' }).expect(202);
    expect(comConta.body).toEqual(semConta.body);
    // o envio começou depois da resposta, e ficou pendurado sozinho
    expect(envios).toBe(1);
  });

  it('limite por IP: a 6ª tentativa em 15 minutos → 429', async () => {
    app = montar({ rateLimit: true });
    for (let i = 0; i < 5; i++) await esqueci(`pessoa${i}@x.dev`, 202);
    const res = await esqueci('mais-uma@x.dev', 429);
    expect(res.body.error.code).toBe('MUITAS_REQUISICOES');
  });
});

describe('POST /api/v1/auth/redefinir-senha', () => {
  async function pedirSenhaNova(email = 'a@x.dev'): Promise<string> {
    await esqueci(email, 202);
    return tokenDoUltimoEmail('/redefinir-senha');
  }

  it('fluxo completo: esqueci → link → senha nova → sessão com o e-mail confirmado; só a nova entra', async () => {
    await cadastrar('a@x.dev').expect(201);
    kit.clock.advance(MINUTO);
    const token = await pedirSenhaNova();
    kit.clock.advance(2 * MINUTO);

    const res = await redefinir(token).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      expiresAt: expect.any(String),
      subscriber: { id: 'id-1', email: 'a@x.dev', emailVerificadoEm: '2026-09-17T12:03:00.000Z', ativo: true },
    });
    await entrar('a@x.dev', OUTRA_SENHA).expect(200);
    await entrar('a@x.dev', SENHA).expect(401);
  });

  it('conta antiga, sem senha: o link cria a primeira e ela passa a entrar com senha', async () => {
    await contaAntiga('antiga@x.dev');
    await redefinir(await pedirSenhaNova('antiga@x.dev'), SENHA).expect(200);
    await entrar('antiga@x.dev', SENHA).expect(200);
  });

  it('link usado, vencido ou inventado → 401 com a mensagem pra tela', async () => {
    await cadastrar('a@x.dev').expect(201);
    kit.clock.advance(MINUTO);
    const usado = await pedirSenhaNova();
    await redefinir(usado).expect(200);
    const res = await redefinir(usado, 'terceira senha aqui').expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: LINK_INVALIDO });

    kit.clock.advance(MINUTO);
    const vencido = await pedirSenhaNova();
    kit.clock.advance(15 * MINUTO + 1);
    await redefinir(vencido).expect(401);

    await redefinir('inventado').expect(401);
    await entrar('a@x.dev', OUTRA_SENHA).expect(200);
  });

  it('senha fora da regra → 400 no campo e o link continua valendo', async () => {
    await cadastrar('a@x.dev').expect(201);
    kit.clock.advance(MINUTO);
    const token = await pedirSenhaNova();

    const res = await redefinir(token, 'curta').expect(400);
    expect(res.body.error.details).toEqual({ senha: 'A senha precisa ter pelo menos 8 caracteres.' });
    await redefinir(token).expect(200);
  });

  it('token ausente ou vazio → 400', async () => {
    await request(app).post('/api/v1/auth/redefinir-senha').send({ senha: OUTRA_SENHA }).expect(400);
    await redefinir('').expect(400);
  });

  it('a senha nova encerra as sessões de antes: quem criou a conta com o seu e-mail (ou roubou a senha) sai', async () => {
    // alguém cria a conta com o e-mail da dona e fica com a sessão de 30 dias
    const intrusa = await criarConta('a@x.dev');
    const outroAparelho = `Bearer ${(await entrar('a@x.dev').expect(200)).body.accessToken}`;
    kit.clock.advance(MINUTO);

    // a dona usa o "Esqueci a senha" e cria a dela
    const res = await redefinir(await pedirSenhaNova()).expect(200);

    for (const velha of [intrusa.bearer, outroAparelho]) {
      const me = await request(app).get('/api/v1/me').set('Authorization', velha).expect(401);
      expect(me.body.error.code).toBe('NAO_AUTENTICADO');
      await trocarSenha(velha, { senhaAtual: OUTRA_SENHA, senhaNova: 'a senha da intrusa' }).expect(401);
      await request(app).post('/api/v1/me/descadastrar').set('Authorization', velha).expect(401);
    }
    await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    // e quem entra depois, com a senha nova, também vale
    const depois = await entrar('a@x.dev', OUTRA_SENHA).expect(200);
    await request(app).get('/api/v1/me').set('Authorization', `Bearer ${depois.body.accessToken}`).expect(200);
  });

  it('o link do "Confirme seu e-mail" não cria senha: 401 e a senha fica', async () => {
    await cadastrar('a@x.dev').expect(201);
    const res = await redefinir(tokenDoUltimoEmail('/entrar')).expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: LINK_INVALIDO });
    await entrar('a@x.dev', SENHA).expect(200);
    await entrar('a@x.dev', OUTRA_SENHA).expect(401);
  });
});

describe('POST /api/v1/auth/verificar (o link do "Confirme seu e-mail")', () => {
  it('confirma o e-mail e abre a sessão; GET /me passa a mostrar a confirmação', async () => {
    await cadastrar('a@x.dev').expect(201);
    kit.clock.advance(5 * MINUTO);

    const res = await verificar(tokenDoUltimoEmail('/entrar')).expect(200);
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
      temSenha: true,
      criadoEm: '2026-09-17T12:00:00.000Z',
    });
  });

  it('segundo uso → 401; vencido (48 h) → 401 e o e-mail continua sem confirmação', async () => {
    await cadastrar('a@x.dev').expect(201);
    const token = tokenDoUltimoEmail('/entrar');
    await verificar(token).expect(200);
    const res = await verificar(token).expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: LINK_INVALIDO });

    await cadastrar('b@x.dev').expect(201);
    kit.clock.advance(48 * HORA + 1);
    await verificar(tokenDoUltimoEmail('/entrar')).expect(401);
    expect((await subscribers.findByEmail('b@x.dev'))?.emailVerificadoEm).toBeNull();
  });

  it('o link de senha nova não abre sessão aqui (seria entrar sem senha): 401, e a senha antiga continua', async () => {
    await cadastrar('a@x.dev').expect(201);
    kit.clock.advance(MINUTO);
    await esqueci('a@x.dev', 202);
    const deSenhaNova = tokenDoUltimoEmail('/redefinir-senha');

    const res = await verificar(deSenhaNova).expect(401);
    expect(res.body.error).toMatchObject({ code: 'NAO_AUTENTICADO', message: LINK_INVALIDO });
    await entrar('a@x.dev', SENHA).expect(200);
    // o link segue valendo pro que ele serve
    await redefinir(deSenhaNova).expect(200);
  });

  it('token que nunca existiu → 401; ausente ou vazio → 400', async () => {
    await verificar('inventado').expect(401);
    await request(app).post('/api/v1/auth/verificar').send({}).expect(400);
    await verificar('').expect(400);
  });
});

describe('POST /api/v1/auth/link-magico (entrar sem senha)', () => {
  it('saiu da API: 404 no formato padrão, sem mandar e-mail', async () => {
    const res = await request(app).post('/api/v1/auth/link-magico').send({ email: 'a@x.dev' }).expect(404);
    expect(res.body.error.code).toBe('ROTA_NAO_ENCONTRADA');
    expect(kit.mailer.sent).toHaveLength(0);
  });
});

describe('GET /api/v1/me', () => {
  it('devolve só a conta da sessão, com temSenha e sem campo interno', async () => {
    const a = await criarConta('a@x.dev');
    await criarConta('b@x.dev');

    const res = await request(app).get('/api/v1/me').set('Authorization', a.bearer).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.email).toBe('a@x.dev');
    expect(Object.keys(res.body).sort()).toEqual(['ativo', 'criadoEm', 'email', 'emailVerificadoEm', 'id', 'temSenha']);
    expect(res.body.temSenha).toBe(true);
    expect(res.text).not.toContain(SENHA);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|consumido|token|senha\(/i);
  });

  it('conta antiga, sem senha → temSenha false', async () => {
    const antiga = await contaAntiga('antiga@x.dev');
    const res = await request(app).get('/api/v1/me').set('Authorization', antiga.bearer).expect(200);
    expect(res.body.temSenha).toBe(false);
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
    const a = await criarConta('a@x.dev');
    kit.sessionAccounts.markDeleted(a.id);
    await request(app).get('/api/v1/me').set('Authorization', a.bearer).expect(401);
  });
});

describe('POST /api/v1/me/senha', () => {
  it('200 com uma sessão nova (sem cache); só a nova senha entra, e as sessões de antes caem — a deste pedido também', async () => {
    const a = await criarConta('a@x.dev');
    kit.clock.advance(MINUTO);
    const outroAparelho = `Bearer ${(await entrar('a@x.dev').expect(200)).body.accessToken}`;

    const res = await trocarSenha(a.bearer, { senhaAtual: SENHA, senhaNova: OUTRA_SENHA }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      expiresAt: expect.any(String),
      subscriber: { id: a.id, email: 'a@x.dev', emailVerificadoEm: null, ativo: true },
    });

    await request(app).get('/api/v1/me').set('Authorization', a.bearer).expect(401);
    await request(app).get('/api/v1/me').set('Authorization', outroAparelho).expect(401);
    await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    await entrar('a@x.dev', OUTRA_SENHA).expect(200);
    await entrar('a@x.dev', SENHA).expect(401);
  });

  it('senha atual errada → 400 VALIDACAO no campo senhaAtual, NUNCA 401 (o front trataria como sessão vencida)', async () => {
    const a = await criarConta('a@x.dev');
    const res = await trocarSenha(a.bearer, { senhaAtual: 'nao e essa nao', senhaNova: OUTRA_SENHA }).expect(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDACAO', details: { senhaAtual: 'A senha atual não confere.' } });
    // a sessão continua valendo
    await request(app).get('/api/v1/me').set('Authorization', a.bearer).expect(200);
    await entrar('a@x.dev', SENHA).expect(200);
  });

  it('sem a senha atual numa conta com senha → 400 pedindo a senha atual', async () => {
    const a = await criarConta('a@x.dev');
    const res = await trocarSenha(a.bearer, { senhaNova: OUTRA_SENHA }).expect(400);
    expect(res.body.error.details).toEqual({ senhaAtual: 'Informe a sua senha atual.' });
  });

  it('conta antiga, sem senha: cria a primeira só com a nova (200, sessão nova) e o /me passa a dizer temSenha', async () => {
    const antiga = await contaAntiga('antiga@x.dev');
    const res = await trocarSenha(antiga.bearer, { senhaNova: SENHA }).expect(200);
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body.temSenha).toBe(true);
    await entrar('antiga@x.dev', SENHA).expect(200);
  });

  it('senha nova fora da regra ou ausente → 400 em senhaNova', async () => {
    const a = await criarConta('a@x.dev');
    const curta = await trocarSenha(a.bearer, { senhaAtual: SENHA, senhaNova: 'curta' }).expect(400);
    expect(curta.body.error.details).toEqual({ senhaNova: 'A senha precisa ter pelo menos 8 caracteres.' });
    const ausente = await trocarSenha(a.bearer, { senhaAtual: SENHA }).expect(400);
    expect(ausente.body.error.details).toEqual({ senhaNova: 'Crie uma senha.' });
  });

  it('id de outra pessoa no corpo é ignorado: só a senha da conta da sessão muda', async () => {
    const a = await criarConta('a@x.dev');
    const b = await criarConta('b@x.dev');
    await trocarSenha(a.bearer, { senhaAtual: SENHA, senhaNova: OUTRA_SENHA, subscriberId: b.id, id: b.id }).expect(200);
    // a sessão da outra pessoa continua valendo
    await request(app).get('/api/v1/me').set('Authorization', b.bearer).expect(200);
    await entrar('b@x.dev', SENHA).expect(200);
    await entrar('a@x.dev', OUTRA_SENHA).expect(200);
  });

  it('sem token → 401; conta inexistente → 404', async () => {
    await request(app).post('/api/v1/me/senha').send({ senhaNova: OUTRA_SENHA }).expect(401);
    await trocarSenha(kit.bearer('nao-existe'), { senhaNova: OUTRA_SENHA }).expect(404);
  });

  it('limite por IP: a 11ª tentativa em 15 minutos → 429 (uma sessão roubada não testa senhas à vontade)', async () => {
    app = montar({ rateLimit: true });
    const a = await criarConta('a@x.dev');
    for (let i = 0; i < 10; i++) await trocarSenha(a.bearer, { senhaAtual: `chute-${i}-errado`, senhaNova: OUTRA_SENHA }).expect(400);
    const res = await trocarSenha(a.bearer, { senhaAtual: SENHA, senhaNova: OUTRA_SENHA }).expect(429);
    expect(res.body.error.code).toBe('MUITAS_REQUISICOES');
  });
});

describe('POST /api/v1/me/descadastrar e /me/reativar', () => {
  it('descadastra (200, ativo=false) e reativa (200, ativo=true), gravando', async () => {
    const a = await criarConta('a@x.dev');

    const fora = await request(app).post('/api/v1/me/descadastrar').set('Authorization', a.bearer).expect(200);
    expect(fora.body).toMatchObject({ id: a.id, email: 'a@x.dev', ativo: false, temSenha: true });
    expect((await subscribers.findById(a.id))?.ativo).toBe(false);

    const dentro = await request(app).post('/api/v1/me/reativar').set('Authorization', a.bearer).expect(200);
    expect(dentro.body).toMatchObject({ id: a.id, ativo: true });
    expect((await subscribers.findById(a.id))?.ativo).toBe(true);
  });

  it('id de outra pessoa no corpo é ignorado: só a conta da sessão muda', async () => {
    const a = await criarConta('a@x.dev');
    const b = await criarConta('b@x.dev');

    await request(app)
      .post('/api/v1/me/descadastrar')
      .set('Authorization', a.bearer)
      .send({ subscriberId: b.id, id: b.id })
      .expect(200);
    expect((await subscribers.findById(a.id))?.ativo).toBe(false);
    expect((await subscribers.findById(b.id))?.ativo).toBe(true);
  });

  it('descadastro não encerra a sessão nem impede de entrar ou pedir senha nova', async () => {
    const a = await criarConta('a@x.dev');
    await request(app).post('/api/v1/me/descadastrar').set('Authorization', a.bearer).expect(200);

    await request(app).get('/api/v1/me').set('Authorization', a.bearer).expect(200);
    await entrar('a@x.dev').expect(200);
    kit.clock.advance(MINUTO);
    await esqueci('a@x.dev', 202);
    expect(kit.mailer.sent).toHaveLength(2);
  });

  it.each(['/api/v1/me/descadastrar', '/api/v1/me/reativar'])('%s sem token → 401; conta inexistente → 404', async (rota) => {
    await request(app).post(rota).expect(401);
    await request(app).post(rota).set('Authorization', kit.bearer('nao-existe')).expect(404);
  });

  it('JSON malformado → 400', async () => {
    const a = await criarConta('a@x.dev');
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
    const a = await criarConta('a@x.dev');
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
    const a = await criarConta('a@x.dev');

    const lixo = await descadastrarPorToken('lixo').expect(401);
    expect(lixo.body.error.message).toBe('Link de descadastro inválido.');
    await descadastrarPorToken(kit.authTokens.issueSession(a.id, 0).token).expect(401);
    expect((await subscribers.findById(a.id))?.ativo).toBe(true);
  });

  it('token ausente → 400', async () => {
    const res = await request(app).post('/api/v1/descadastrar').send({}).expect(400);
    expect(res.body.error.details).toHaveProperty('token');
  });
});

describe('limite por IP nas rotas que conferem token', () => {
  it.each([
    ['/api/v1/auth/verificar', { token: 'chute' }, 401],
    ['/api/v1/auth/redefinir-senha', { token: 'chute', senha: OUTRA_SENHA }, 401],
    ['/api/v1/descadastrar', { token: 'chute' }, 401],
  ])('%s: a 21ª tentativa em 15 minutos → 429', async (rota, corpo, statusNormal) => {
    app = montar({ rateLimit: true });
    for (let i = 0; i < 20; i++) await request(app).post(rota).send(corpo).expect(statusNormal);

    const res = await request(app).post(rota).send(corpo).expect(429);
    expect(res.body.error.code).toBe('MUITAS_REQUISICOES');
  });
});
