import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { CheckIn, competenciaAnterior, competenciaDe, competenciaValida } from './check-in';

describe('competência', () => {
  it('usa o fuso de São Paulo: 02:30 UTC do dia 1 ainda é o mês anterior', () => {
    expect(competenciaDe(new Date('2026-10-01T02:30:00.000Z'))).toBe('2026-09');
    expect(competenciaDe(new Date('2026-10-01T03:00:00.000Z'))).toBe('2026-10');
  });

  it('competenciaAnterior é o mês que acabou, virando o ano', () => {
    expect(competenciaAnterior(new Date('2026-10-01T12:00:00.000Z'))).toBe('2026-09');
    expect(competenciaAnterior(new Date('2027-01-01T12:00:00.000Z'))).toBe('2026-12');
    // job rodando 00:30 de Brasília no dia 1 (03:30 UTC): abre o mês que acabou
    expect(competenciaAnterior(new Date('2026-10-01T03:30:00.000Z'))).toBe('2026-09');
  });

  it.each(['2026-9', '2026-13', '2026-00', '1999-01', '2101-01', 'abc'])('inválida %j', (c) => {
    expect(competenciaValida(c)).toBe(false);
  });
});

describe('CheckIn', () => {
  const agora = new Date('2026-10-01T12:00:00.000Z');

  it('abre o mês anterior e o corrente; recusa o futuro', () => {
    expect(CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora }).competencia).toBe('2026-09');
    expect(CheckIn.abrir({ id: 'c2', subscriberId: 's1', competencia: '2026-10', agora }).competencia).toBe('2026-10');
    expect(() => CheckIn.abrir({ id: 'c3', subscriberId: 's1', competencia: '2026-11', agora })).toThrow(
      ValidationError,
    );
  });

  it('responde com centavos e pode corrigir a resposta', () => {
    const c = CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora });
    c.responder({ rendaReal: 1234.56, gastoReal: 0.07, guardadoReal: 1.1 }, agora);
    expect(c.respondido).toBe(true);
    c.responder({ rendaReal: 2000, gastoReal: 1500, guardadoReal: 500 }, new Date('2026-10-02T12:00:00.000Z'));
    expect(c.toSnapshot()).toMatchObject({ rendaReal: 2000, respondidoEm: new Date('2026-10-02T12:00:00.000Z') });
  });

  it('recusa 3 casas e negativo', () => {
    const c = CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora });
    expect(() => c.responder({ rendaReal: 10.005, gastoReal: 0, guardadoReal: 0 }, agora)).toThrow(ValidationError);
    expect(() => c.responder({ rendaReal: 0, gastoReal: -1, guardadoReal: 0 }, agora)).toThrow(ValidationError);
  });

  it('nasce aberto: sem resposta, sem envio, criado agora', () => {
    const c = CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora });
    expect(c.toSnapshot()).toEqual({
      id: 'c1',
      subscriberId: 's1',
      competencia: '2026-09',
      rendaReal: null,
      gastoReal: null,
      guardadoReal: null,
      enviadoEm: null,
      respondidoEm: null,
      criadoEm: agora,
    });
    expect(c.respondido).toBe(false);
  });

  it.each(['setembro', '2026-9', '2026-13', '1999-12'])('abrir com competência inválida %j → detalhe no campo', (competencia) => {
    try {
      CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia, agora });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toEqual({ competencia: 'Competência no formato AAAA-MM' });
    }
  });

  it('mês futuro: mensagem pronta pra tela, no campo competencia', () => {
    try {
      CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2027-01', agora });
      expect.unreachable();
    } catch (e) {
      expect((e as ValidationError).details).toEqual({ competencia: 'Esse mês ainda não chegou' });
    }
  });

  it('responder confere o mês de novo: restaurado com competência futura (relógio adiantado) é recusado', () => {
    const c = CheckIn.restaurar({
      ...CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-10', agora }).toSnapshot(),
      competencia: '2026-11',
    });
    expect(() => c.responder({ rendaReal: 1, gastoReal: 1, guardadoReal: 1 }, agora)).toThrow('Esse mês ainda não chegou');
    expect(c.respondido).toBe(false);
  });

  it.each([
    [{ rendaReal: Number.NaN, gastoReal: 0, guardadoReal: 0 }, { rendaReal: 'Informe quanto entrou (pode ser 0)' }],
    [{ rendaReal: 0, gastoReal: Number.POSITIVE_INFINITY, guardadoReal: 0 }, { gastoReal: 'Informe quanto saiu (pode ser 0)' }],
    [{ rendaReal: 0, gastoReal: 0, guardadoReal: 10_000_000_000 }, { guardadoReal: 'Informe quanto sobrou guardado (pode ser 0)' }],
  ])('resposta inválida %j → detalhe do campo', (resposta, details) => {
    const c = CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora });
    try {
      c.responder(resposta, agora);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toEqual(details);
    }
  });

  it('aceita centavos que o ponto flutuante recusaria com Math.round (R$ 19,99, R$ 1,10) e o teto do banco', () => {
    const c = CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora });
    c.responder({ rendaReal: 19.99, gastoReal: 1.1, guardadoReal: 9_999_999_999.99 }, agora);
    expect(c.toSnapshot()).toMatchObject({ rendaReal: 19.99, gastoReal: 1.1, guardadoReal: 9_999_999_999.99 });
  });

  it('resposta inválida não muda nada: o último campo falha e os anteriores continuam como estavam', () => {
    const c = CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora });
    c.responder({ rendaReal: 100, gastoReal: 50, guardadoReal: 50 }, agora);
    const depois = new Date('2026-10-02T12:00:00.000Z');
    expect(() => c.responder({ rendaReal: 999, gastoReal: 999, guardadoReal: 0.001 }, depois)).toThrow(ValidationError);
    expect(c.toSnapshot()).toMatchObject({ rendaReal: 100, gastoReal: 50, guardadoReal: 50, respondidoEm: agora });
  });

  it('responder não confia em chave extra: dono, id e envio não mudam', () => {
    const c = CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora });
    const malicioso = { rendaReal: 1, gastoReal: 1, guardadoReal: 1, subscriberId: 'invasor', id: 'x', enviadoEm: agora } as never;
    c.responder(malicioso, agora);
    expect(c.toSnapshot()).toMatchObject({ id: 'c1', subscriberId: 's1', enviadoEm: null });
  });

  it('marcarEnviado grava a data do envio sem responder', () => {
    const c = CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora });
    c.marcarEnviado(agora);
    expect(c.enviadoEm).toEqual(agora);
    expect(c.respondido).toBe(false);
  });

  it('restaurar e toSnapshot copiam fundo: mexer na origem, no snapshot ou numa data não altera a entidade', () => {
    const origem = CheckIn.abrir({ id: 'c1', subscriberId: 's1', competencia: '2026-09', agora }).toSnapshot();
    const c = CheckIn.restaurar(origem);
    origem.criadoEm.setFullYear(1990);
    origem.competencia = '2020-01';
    const snap = c.toSnapshot();
    snap.criadoEm.setFullYear(1991);
    snap.rendaReal = 1;
    expect(c.criadoEm).toEqual(agora);
    expect(c.competencia).toBe('2026-09');
    expect(c.rendaReal).toBeNull();
  });
});
