import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../in-memory/doubles';
import { JwtAuthTokenService } from './jwt-auth-token-service';

const SEGREDO = 'segredo-do-teste-do-jwt-com-mais-de-32-caracteres';
const DIA = 24 * 60 * 60;

function servico() {
  const clock = new FixedClock('2026-09-24T12:00:00.000Z');
  const tokens = new JwtAuthTokenService({ secret: SEGREDO, sessionTtlSeconds: 30 * DIA, unsubscribeTtlSeconds: 365 * DIA }, clock);
  return { clock, tokens };
}

/** um token de sessão assinado à mão, com o payload que o teste quiser */
function assinar(payload: Record<string, unknown>): string {
  const agora = Math.floor(new Date('2026-09-24T12:00:00.000Z').getTime() / 1000);
  return jwt.sign({ iat: agora, exp: agora + DIA, ...payload }, SEGREDO, {
    algorithm: 'HS256',
    issuer: 'dindin-api',
    audience: 'sessao',
  });
}

describe('JwtAuthTokenService — sessão com a versão da conta', () => {
  it('a sessão carrega a versão com que saiu', () => {
    const { tokens } = servico();
    expect(tokens.verifySession(tokens.issueSession('sub-1', 0).token)).toEqual({ subscriberId: 'sub-1', versao: 0 });
    expect(tokens.verifySession(tokens.issueSession('sub-1', 3).token)).toEqual({ subscriberId: 'sub-1', versao: 3 });
  });

  it('token de antes desta regra (sem versão) conta como versão 0: segue valendo até a primeira senha nova', () => {
    const { tokens } = servico();
    expect(tokens.verifySession(assinar({ sub: 'sub-1' }))).toEqual({ subscriberId: 'sub-1', versao: 0 });
  });

  it.each([['texto', '1'], ['negativa', -1], ['quebrada', 1.5], ['nula', null]])('versão %s no token → inválido', (_caso, ver) => {
    const { tokens } = servico();
    expect(tokens.verifySession(assinar({ sub: 'sub-1', ver }))).toBeNull();
  });

  it('versão estranha na emissão é defeito de programação: lança', () => {
    const { tokens } = servico();
    expect(() => tokens.issueSession('sub-1', -1)).toThrow('versão de sessão inválida');
    expect(() => tokens.issueSession('sub-1', Number.NaN)).toThrow('versão de sessão inválida');
  });

  it('descadastro e sessão continuam sem servir um pelo outro', () => {
    const { tokens } = servico();
    expect(tokens.verifyUnsubscribe(tokens.issueSession('sub-1', 0).token)).toBeNull();
    expect(tokens.verifySession(tokens.issueUnsubscribe('sub-1').token)).toBeNull();
    expect(tokens.verifyUnsubscribe(tokens.issueUnsubscribe('sub-1').token)).toEqual({ subscriberId: 'sub-1' });
  });

  it('vencida → null', () => {
    const { tokens, clock } = servico();
    const { token } = tokens.issueSession('sub-1', 0);
    clock.advance(30 * DIA * 1000 + 1000);
    expect(tokens.verifySession(token)).toBeNull();
  });
});
