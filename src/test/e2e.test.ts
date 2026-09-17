import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { APP_URL_E2E, executarFluxoCompleto, montarAmbiente, retratoDaConta } from './e2e-fluxo';

/*
  Ponta a ponta com PERSISTENCIA=memoria: a composição inteira da produção
  (config → container → rotas dos nove módulos), sem banco. O mesmo fluxo roda
  contra Postgres em e2e.integration.test.ts.
*/

describe('e2e (memória)', () => {
  it('o fluxo completo: link mágico → perfil → plano → meta → check-in → job → descadastro → exportar → excluir', async () => {
    const ambiente = montarAmbiente();
    const { ana, bruno, passos } = await executarFluxoCompleto(ambiente);

    expect(passos).toHaveLength(21);
    // a exclusão da Ana não levou a do Bruno, e o catálogo continua inteiro
    const r = ambiente.container.repositories;
    expect((await retratoDaConta(r, ana.id)).conta).toBe(false);
    expect((await retratoDaConta(r, bruno.id)).conta).toBe(true);
    expect(await r.categorias.listVisible(null)).toHaveLength(24);
  });

  it('RATE_LIMIT ligado pela config: o 6º pedido de link do mesmo IP em 15 min é 429', async () => {
    const { app, mailer } = montarAmbiente({ RATE_LIMIT: 'true' });
    for (let i = 1; i <= 5; i++) {
      await request(app).post('/api/v1/auth/link-magico').send({ email: `pessoa${i}@exemplo.com` }).expect(202);
    }
    const bloqueado = await request(app).post('/api/v1/auth/link-magico').send({ email: 'pessoa6@exemplo.com' }).expect(429);
    expect(bloqueado.body.error.code).toBe('MUITAS_REQUISICOES');
    expect(mailer.sent).toHaveLength(5);
  });

  it('com NODE_ENV=test o limite fica desligado', async () => {
    const { app } = montarAmbiente();
    for (let i = 1; i <= 6; i++) {
      await request(app).post('/api/v1/auth/link-magico').send({ email: `pessoa${i}@exemplo.com` }).expect(202);
    }
  });

  it('CORS expõe Location e Content-Disposition pro frontend em outra origem', async () => {
    const { app } = montarAmbiente();
    const res = await request(app).get('/api/health').set('Origin', APP_URL_E2E).expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(APP_URL_E2E);
    const expostos = String(res.headers['access-control-expose-headers']).split(',').map((h) => h.trim());
    expect(expostos).toEqual(expect.arrayContaining(['Location', 'Content-Disposition', 'X-Request-Id']));
  });

  it('rota inexistente responde no formato de erro padrão', async () => {
    const { app } = montarAmbiente();
    const res = await request(app).get('/api/v1/nao-existe').expect(404);
    expect(res.body).toEqual({
      error: { code: 'ROTA_NAO_ENCONTRADA', message: 'Rota não encontrada: GET /api/v1/nao-existe', requestId: expect.any(String) },
    });
  });
});
