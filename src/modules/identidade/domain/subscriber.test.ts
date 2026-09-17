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

  it('invalidar o link (envio falhou) inutiliza o token sem confirmar o e-mail', () => {
    const s = novo('s1');
    const depois = new Date('2026-09-17T12:00:05.000Z');
    s.invalidarLinkMagico(depois);
    expect(s.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}s1`);
    expect(s.tokenExpiraEm).toBeNull();
    expect(s.emailVerificadoEm).toBeNull();
    expect(s.atualizadoEm).toEqual(depois);
    // sem link pendente: o próximo pedido não fica preso no limite de reenvio
    expect(s.linkEmitidoEm(15)).toBeNull();
    expect(() => s.consumirLinkMagico(depois)).toThrow(UnauthorizedError);
  });

  it('invalidar depois de verificado mantém a verificação', () => {
    const s = novo('s1');
    s.consumirLinkMagico(agora);
    s.emitirLinkMagico('hash-novo', emQuinzeMin, agora);
    s.invalidarLinkMagico(agora);
    expect(s.emailVerificadoEm).toEqual(agora);
    expect(s.podeReceberEmail).toBe(true);
  });

  it('link novo depois de consumido volta a funcionar, e só até vencer', () => {
    const s = novo('s1');
    s.consumirLinkMagico(agora);
    const emissao = new Date('2026-09-18T08:00:00.000Z');
    s.emitirLinkMagico('hash-novo', new Date('2026-09-18T08:15:00.000Z'), emissao);
    expect(s.tokenHash).toBe('hash-novo');
    expect(s.linkEmitidoEm(15)).toEqual(emissao);
    // no instante exato do vencimento ainda vale
    expect(() => s.consumirLinkMagico(new Date('2026-09-18T08:15:00.000Z'))).not.toThrow();
  });

  it('descadastrada ainda consegue entrar pelo link', () => {
    const s = novo('s1');
    s.descadastrar(agora);
    expect(() => s.consumirLinkMagico(agora)).not.toThrow();
    expect(s.ativo).toBe(false);
  });

  it('descadastrar e reativar repetidos não mexem em atualizadoEm', () => {
    const s = novo('s1');
    const depois = new Date('2026-09-20T00:00:00.000Z');
    s.reativar(depois);
    expect(s.atualizadoEm).toEqual(agora);
    s.descadastrar(depois);
    s.descadastrar(new Date('2026-09-21T00:00:00.000Z'));
    expect(s.atualizadoEm).toEqual(depois);
  });

  it('restaurar e toSnapshot copiam: mexer na origem ou na cópia não altera a entidade', () => {
    const props = novo('s1').toSnapshot();
    const s = Subscriber.restaurar(props);
    props.email = 'outra@x.dev';
    props.tokenExpiraEm?.setFullYear(1990);
    const snap = s.toSnapshot();
    snap.ativo = false;
    snap.criadoEm.setFullYear(1990);
    expect(s.email).toBe('s1@x.dev');
    expect(s.tokenExpiraEm).toEqual(emQuinzeMin);
    expect(s.ativo).toBe(true);
    expect(s.criadoEm).toEqual(agora);
  });
});
