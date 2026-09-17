import { describe, expect, it } from 'vitest';
import { UnauthorizedError, ValidationError } from '../../../shared/domain/errors';
import { normalizarEmail, PREFIXO_TOKEN_CONSUMIDO, Subscriber } from './subscriber';

const agora = new Date('2026-09-17T12:00:00.000Z');
const emQuinzeMin = new Date('2026-09-17T12:15:00.000Z');

const novo = (id: string, email = `${id}@x.dev`) =>
  Subscriber.criar({ id, email, tokenHash: `hash-${id}`, tokenExpiraEm: emQuinzeMin, agora });

describe('Subscriber', () => {
  it('nasce ativo, sem e-mail verificado, e não pode receber e-mail mensal', () => {
    const s = novo('s1', '  Pessoa@Exemplo.COM ');
    expect(s.email).toBe('pessoa@exemplo.com');
    expect(s.ativo).toBe(true);
    expect(s.emailVerificadoEm).toBeNull();
    expect(s.podeReceberEmail).toBe(false);
  });

  it('consumir o link confirma o e-mail e inutiliza o token', () => {
    const s = novo('s1');
    s.consumirLinkMagico(new Date('2026-09-17T12:05:00.000Z'));
    expect(s.emailVerificadoEm).toEqual(new Date('2026-09-17T12:05:00.000Z'));
    expect(s.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}s1`);
    expect(s.tokenExpiraEm).toBeNull();
    expect(s.podeReceberEmail).toBe(true);
  });

  it('duas pessoas consumindo ficam com tokens diferentes (a coluna é UNIQUE NOT NULL)', () => {
    const a = novo('s1');
    const b = novo('s2');
    a.consumirLinkMagico(agora);
    b.consumirLinkMagico(agora);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('segundo uso do mesmo link falha', () => {
    const s = novo('s1');
    s.consumirLinkMagico(agora);
    expect(() => s.consumirLinkMagico(agora)).toThrow(UnauthorizedError);
  });

  it('link vencido falha e não muda nada', () => {
    const s = novo('s1');
    expect(() => s.consumirLinkMagico(new Date('2026-09-17T12:15:00.001Z'))).toThrow(UnauthorizedError);
    expect(s.tokenHash).toBe('hash-s1');
    expect(s.emailVerificadoEm).toBeNull();
  });

  it('verificação do e-mail registra só a primeira vez', () => {
    const s = novo('s1');
    s.consumirLinkMagico(agora);
    s.emitirLinkMagico('hash-novo', new Date('2026-10-01T12:15:00.000Z'), new Date('2026-10-01T12:00:00.000Z'));
    s.consumirLinkMagico(new Date('2026-10-01T12:01:00.000Z'));
    expect(s.emailVerificadoEm).toEqual(agora);
  });

  it('linkEmitidoEm deduz a emissão pela validade', () => {
    expect(novo('s1').linkEmitidoEm(15)).toEqual(agora);
    const s = novo('s2');
    s.consumirLinkMagico(agora);
    expect(s.linkEmitidoEm(15)).toBeNull();
  });

  it('descadastrar não bloqueia login, só o e-mail mensal', () => {
    const s = novo('s1');
    s.consumirLinkMagico(agora);
    s.descadastrar(agora);
    expect(s.podeReceberEmail).toBe(false);
    s.reativar(agora);
    expect(s.podeReceberEmail).toBe(true);
  });

  it.each(['', 'sem-arroba', 'a@b', `${'x'.repeat(250)}@x.dev`])('e-mail inválido %j', (email) => {
    expect(() => normalizarEmail(email)).toThrow(ValidationError);
  });
});
