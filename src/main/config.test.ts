import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const SEGREDO = 'x'.repeat(32);

describe('loadConfig', () => {
  it('lista todos os problemas de uma vez, não só o primeiro', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://postgres:SUA_SENHA@localhost:5432/dindin' })).toThrow(
      /JWT_SECRET: obrigatória[\s\S]*DATABASE_URL: ainda tem a senha de exemplo/,
    );
  });

  it('modo memória sobe só com o segredo', () => {
    const c = loadConfig({ PERSISTENCIA: 'memoria', JWT_SECRET: SEGREDO });
    expect(c).toMatchObject({
      env: 'development',
      port: 3701,
      persistence: 'memoria',
      corsOrigins: ['http://localhost:3700'],
      sessionTtlSeconds: 30 * 24 * 60 * 60,
      mail: { provider: 'console' },
    });
  });

  it('segredo curto é recusado', () => {
    expect(() => loadConfig({ PERSISTENCIA: 'memoria', JWT_SECRET: 'curto' })).toThrow(/pelo menos 32/);
  });

  it('CORS com várias origens e barra final da APP_URL removida', () => {
    const c = loadConfig({
      PERSISTENCIA: 'memoria',
      JWT_SECRET: SEGREDO,
      CORS_ORIGIN: 'https://dindin.app, https://www.dindin.app',
      APP_URL: 'https://dindin.app/',
    });
    expect(c.corsOrigins).toEqual(['https://dindin.app', 'https://www.dindin.app']);
    expect(c.appUrl).toBe('https://dindin.app');
  });

  /*
    O boot da Vercel em 29/09/2026: as variáveis existiam no painel com o valor em
    branco, e a API caía com "PORT: pequeno demais", "PERSISTENCIA: opção
    inválida"… — oito erros, nenhum dizendo o que faltava.
  */
  it('variável vazia vale como ausente: cai no padrão', () => {
    const c = loadConfig({
      PERSISTENCIA: 'memoria',
      JWT_SECRET: SEGREDO,
      PORT: '',
      LOG_REQUESTS: '',
      RATE_LIMIT: ' ',
      SESSAO_DIAS: '',
      LINK_MAGICO_MINUTOS: '',
      LINK_CONFIRMACAO_HORAS: '',
      EMAIL_PROVEDOR: '',
      CORS_ORIGIN: '',
    });
    expect(c).toMatchObject({
      port: 3701,
      logRequests: true,
      sessionTtlSeconds: 30 * 24 * 60 * 60,
      resetLinkTtlMinutes: 15,
      confirmationLinkTtlHours: 48,
      corsOrigins: ['http://localhost:3700'],
      mail: { provider: 'console' },
    });
  });

  it('em produção com tudo vazio, o erro diz o que falta de verdade', () => {
    const vazio = (chaves: string[]) => Object.fromEntries(chaves.map((k) => [k, '']));
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        ...vazio(['PORT', 'PERSISTENCIA', 'DATABASE_URL', 'JWT_SECRET', 'EMAIL_PROVEDOR', 'APP_URL']),
      }),
    ).toThrow(/JWT_SECRET: obrigatória[\s\S]*DATABASE_URL: obrigatória[\s\S]*EMAIL_PROVEDOR/);
  });

  it('em produção, CORS_ORIGIN ausente (o padrão localhost) não sobe', () => {
    const producao = {
      NODE_ENV: 'production',
      PERSISTENCIA: 'prisma',
      DATABASE_URL: 'postgresql://u:p@db.exemplo.com:5432/dindin',
      JWT_SECRET: SEGREDO,
      EMAIL_PROVEDOR: 'resend',
      RESEND_API_KEY: 're_x',
      APP_URL: 'https://dindin.gabrieltramontin.com.br',
    };
    expect(() => loadConfig({ ...producao, CORS_ORIGIN: '' })).toThrow(/CORS_ORIGIN: em produção, informe o endereço do site/);
    expect(() => loadConfig({ ...producao, CORS_ORIGIN: 'http://localhost:3700/' })).toThrow(/CORS_ORIGIN/);
    expect(loadConfig({ ...producao, CORS_ORIGIN: 'https://dindin.gabrieltramontin.com.br' }).corsOrigins).toEqual([
      'https://dindin.gabrieltramontin.com.br',
    ]);
  });

  it('espaço em volta do valor sai (colado do painel)', () => {
    const c = loadConfig({ PERSISTENCIA: ' memoria ', JWT_SECRET: ` ${SEGREDO} `, PORT: ' 8080 ' });
    expect(c.persistence).toBe('memoria');
    expect(c.jwtSecret).toBe(SEGREDO);
    expect(c.port).toBe(8080);
  });

  it('CORS tira a barra do fim: o navegador manda a origem sem ela', () => {
    const c = loadConfig({
      PERSISTENCIA: 'memoria',
      JWT_SECRET: SEGREDO,
      CORS_ORIGIN: 'https://dindin.gabrieltramontin.com.br/, https://www.dindin.app//',
    });
    expect(c.corsOrigins).toEqual(['https://dindin.gabrieltramontin.com.br', 'https://www.dindin.app']);
  });

  it('produção recusa memória, e-mail no console e CORS aberto — tudo junto', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', PERSISTENCIA: 'memoria', JWT_SECRET: SEGREDO, CORS_ORIGIN: '*' }),
    ).toThrow(/PERSISTENCIA[\s\S]*EMAIL_PROVEDOR[\s\S]*CORS_ORIGIN/);
  });

  it('produção exige APP_URL https e fora de localhost', () => {
    const base = {
      NODE_ENV: 'production',
      JWT_SECRET: SEGREDO,
      DATABASE_URL: 'postgresql://u:p@db:5432/dindin',
      EMAIL_PROVEDOR: 'resend',
      RESEND_API_KEY: 're_x',
      CORS_ORIGIN: 'https://dindin.app',
    };
    expect(() => loadConfig({ ...base })).toThrow(/APP_URL: não pode ser localhost/);
    expect(() => loadConfig({ ...base, APP_URL: 'http://dindin.app' })).toThrow(/APP_URL: precisa ser https/);
    expect(loadConfig({ ...base, APP_URL: 'https://dindin.app' }).appUrl).toBe('https://dindin.app');
  });

  it('resend exige a chave', () => {
    expect(() => loadConfig({ PERSISTENCIA: 'memoria', JWT_SECRET: SEGREDO, EMAIL_PROVEDOR: 'resend' })).toThrow(
      /RESEND_API_KEY/,
    );
  });

  describe('RATE_LIMIT', () => {
    const memoria = { PERSISTENCIA: 'memoria', JWT_SECRET: SEGREDO };

    it('sem valor: ligado em desenvolvimento e produção, desligado com NODE_ENV=test', () => {
      expect(loadConfig({ ...memoria }).rateLimitEnabled).toBe(true);
      expect(loadConfig({ ...memoria, NODE_ENV: 'test' }).rateLimitEnabled).toBe(false);
      expect(
        loadConfig({
          NODE_ENV: 'production',
          JWT_SECRET: SEGREDO,
          DATABASE_URL: 'postgresql://u:p@db:5432/dindin',
          EMAIL_PROVEDOR: 'resend',
          RESEND_API_KEY: 're_x',
          CORS_ORIGIN: 'https://dindin.app',
          APP_URL: 'https://dindin.app',
        }).rateLimitEnabled,
      ).toBe(true);
    });

    it('valor explícito vence o padrão do ambiente', () => {
      expect(loadConfig({ ...memoria, RATE_LIMIT: 'false' }).rateLimitEnabled).toBe(false);
      expect(loadConfig({ ...memoria, RATE_LIMIT: '0' }).rateLimitEnabled).toBe(false);
      expect(loadConfig({ ...memoria, NODE_ENV: 'test', RATE_LIMIT: 'true' }).rateLimitEnabled).toBe(true);
      expect(loadConfig({ ...memoria, NODE_ENV: 'test', RATE_LIMIT: '1' }).rateLimitEnabled).toBe(true);
    });

    it('valor que não é booleano é recusado', () => {
      expect(() => loadConfig({ ...memoria, RATE_LIMIT: 'sim' })).toThrow(/RATE_LIMIT/);
    });
  });

  describe('validade dos links do e-mail', () => {
    const memoria = { PERSISTENCIA: 'memoria', JWT_SECRET: SEGREDO };

    it('padrão: confirmação do e-mail em 48 h, senha nova em 15 min', () => {
      expect(loadConfig({ ...memoria })).toMatchObject({ confirmationLinkTtlHours: 48, resetLinkTtlMinutes: 15 });
    });

    it('LINK_CONFIRMACAO_HORAS e LINK_MAGICO_MINUTOS (o nome antigo continua valendo pro link de senha nova)', () => {
      expect(
        loadConfig({ ...memoria, LINK_CONFIRMACAO_HORAS: '24', LINK_MAGICO_MINUTOS: '30' }),
      ).toMatchObject({ confirmationLinkTtlHours: 24, resetLinkTtlMinutes: 30 });
    });

    it('LINK_CONFIRMACAO_HORAS recusa zero, fração, texto e mais de uma semana', () => {
      for (const valor of ['0', '1.5', 'abc', '169']) {
        expect(() => loadConfig({ ...memoria, LINK_CONFIRMACAO_HORAS: valor })).toThrow(/LINK_CONFIRMACAO_HORAS/);
      }
      expect(loadConfig({ ...memoria, LINK_CONFIRMACAO_HORAS: '168' }).confirmationLinkTtlHours).toBe(168);
    });

    it('LINK_MAGICO_MINUTOS continua entre 5 e 1440', () => {
      for (const valor of ['4', '1441']) {
        expect(() => loadConfig({ ...memoria, LINK_MAGICO_MINUTOS: valor })).toThrow(/LINK_MAGICO_MINUTOS/);
      }
    });
  });

  describe('LINK_REENVIO_SEGUNDOS', () => {
    const memoria = { PERSISTENCIA: 'memoria', JWT_SECRET: SEGREDO };
    const producao = {
      NODE_ENV: 'production',
      JWT_SECRET: SEGREDO,
      DATABASE_URL: 'postgresql://u:p@db:5432/dindin',
      EMAIL_PROVEDOR: 'resend',
      RESEND_API_KEY: 're_x',
      CORS_ORIGIN: 'https://dindin.app',
      APP_URL: 'https://dindin.app',
    };

    it('padrão é 60 s, a regra do produto', () => {
      expect(loadConfig({ ...memoria }).linkResendCooldownSeconds).toBe(60);
    });

    it('aceita outro valor fora de produção (inclusive 0, pra demo)', () => {
      expect(loadConfig({ ...memoria, LINK_REENVIO_SEGUNDOS: '120' }).linkResendCooldownSeconds).toBe(120);
      expect(loadConfig({ ...memoria, LINK_REENVIO_SEGUNDOS: '0' }).linkResendCooldownSeconds).toBe(0);
    });

    it('recusa negativo, fração, texto e mais de 1 hora', () => {
      for (const valor of ['-1', '1.5', 'abc', '3601']) {
        expect(() => loadConfig({ ...memoria, LINK_REENVIO_SEGUNDOS: valor })).toThrow(/LINK_REENVIO_SEGUNDOS/);
      }
    });

    it('produção não aceita menos que 60 s', () => {
      expect(() => loadConfig({ ...producao, LINK_REENVIO_SEGUNDOS: '10' })).toThrow(
        /LINK_REENVIO_SEGUNDOS: precisa ser pelo menos 60 em produção/,
      );
      expect(loadConfig({ ...producao, LINK_REENVIO_SEGUNDOS: '90' }).linkResendCooldownSeconds).toBe(90);
    });
  });
});
