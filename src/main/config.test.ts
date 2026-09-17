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
      port: 3333,
      persistence: 'memoria',
      corsOrigins: ['http://localhost:3000'],
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
