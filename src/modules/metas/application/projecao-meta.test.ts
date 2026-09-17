import { describe, expect, it } from 'vitest';
import { TAXA_LIVRE_RISCO_ANUAL } from '../../../shared/motor/config';
import { aporteParaMeta, mesesParaMeta } from '../../../shared/motor/projecao';
import { Meta } from '../domain/meta';
import { mesDaqui, projetarMeta } from './projecao-meta';

const agora = new Date('2026-09-17T12:00:00.000Z');

const meta = (dados: { valorAlvo: number; acumulado?: number; aporteMensal?: number; prazoMeses?: number }) =>
  Meta.criar({ id: 'm1', subscriberId: 'sub-1', nome: 'Viagem', agora, ...dados });

describe('mesDaqui', () => {
  it('soma meses ao mês de agora, virando o ano', () => {
    expect(mesDaqui(agora, 0)).toBe('2026-09');
    expect(mesDaqui(agora, 3)).toBe('2026-12');
    expect(mesDaqui(agora, 4)).toBe('2027-01');
    expect(mesDaqui(agora, 16)).toBe('2028-01');
    expect(mesDaqui(agora, 1200)).toBe('2126-09');
  });

  it('conta o mês no fuso de São Paulo: 02:00 UTC do dia 1º ainda é o mês anterior', () => {
    const viradaUtc = new Date('2026-10-01T02:00:00.000Z');
    expect(mesDaqui(viradaUtc, 0)).toBe('2026-09');
    expect(mesDaqui(viradaUtc, 1)).toBe('2026-10');
    expect(mesDaqui(new Date('2027-01-01T02:59:59.000Z'), 0)).toBe('2026-12');
    expect(mesDaqui(new Date('2027-01-01T03:00:00.000Z'), 0)).toBe('2027-01');
  });
});

describe('projetarMeta com aporte mensal', () => {
  it('calcula os meses pelo motor e deixa o aporte necessário null', () => {
    expect(projetarMeta(meta({ valorAlvo: 1000, aporteMensal: 250 }), agora, 0)).toEqual({
      faltante: 1000,
      aporteNecessario: null,
      mesesEstimados: 4,
      mesEstimado: '2027-01',
    });
  });

  it('o acumulado entra como saldo inicial', () => {
    expect(projetarMeta(meta({ valorAlvo: 1000, acumulado: 500, aporteMensal: 250 }), agora, 0)).toMatchObject({
      faltante: 500,
      mesesEstimados: 2,
      mesEstimado: '2026-11',
    });
  });

  it('sem taxa informada usa a taxa livre de risco do motor', () => {
    const m = meta({ valorAlvo: 50000, acumulado: 1000.5, aporteMensal: 800 });
    const esperado = mesesParaMeta({ saldoInicial: 1000.5, aporteMensal: 800, taxaAnual: TAXA_LIVRE_RISCO_ANUAL }, 50000);
    expect(esperado).not.toBeNull();
    expect(projetarMeta(m, agora).mesesEstimados).toBe(esperado);
    expect(projetarMeta(m, agora).mesesEstimados).toBeLessThan(62); // sem juros seriam 62 meses
  });

  it('aporte que não chega em 100 anos: meses e mês estimado null', () => {
    expect(projetarMeta(meta({ valorAlvo: 1_000_000, aporteMensal: 0.01 }), agora, 0)).toEqual({
      faltante: 1_000_000,
      aporteNecessario: null,
      mesesEstimados: null,
      mesEstimado: null,
    });
  });
});

describe('projetarMeta com prazo', () => {
  it('calcula o aporte pelo motor; os meses são o prazo', () => {
    expect(projetarMeta(meta({ valorAlvo: 1000, acumulado: 200, prazoMeses: 4 }), agora, 0)).toEqual({
      faltante: 800,
      aporteNecessario: 200,
      mesesEstimados: 4,
      mesEstimado: '2027-01',
    });
  });

  it('sem taxa informada usa a taxa livre de risco do motor', () => {
    const m = meta({ valorAlvo: 12000, acumulado: 350.25, prazoMeses: 12 });
    const esperado = aporteParaMeta(12000, 12, { saldoInicial: 350.25, taxaAnual: TAXA_LIVRE_RISCO_ANUAL });
    expect(projetarMeta(m, agora).aporteNecessario).toBe(esperado);
    expect(esperado).toBeLessThan((12000 - 350.25) / 12);
  });

  it('acumulado que chega sozinho pelo rendimento: aporte 0, mas ainda falta dinheiro hoje', () => {
    expect(projetarMeta(meta({ valorAlvo: 1000, acumulado: 950, prazoMeses: 12 }), agora)).toMatchObject({
      faltante: 50,
      aporteNecessario: 0,
      mesesEstimados: 12,
    });
  });
});

describe('projetarMeta de meta atingida', () => {
  it.each([
    ['por aporte', { aporteMensal: 100 }],
    ['por prazo', { prazoMeses: 24 }],
  ])('%s: faltante 0, aporte 0, 0 meses, mês de agora', (_modo, extra) => {
    expect(projetarMeta(meta({ valorAlvo: 1000, acumulado: 1000, ...extra }), agora)).toEqual({
      faltante: 0,
      aporteNecessario: 0,
      mesesEstimados: 0,
      mesEstimado: '2026-09',
    });
  });

  it('passar do alvo não deixa faltante negativo', () => {
    expect(projetarMeta(meta({ valorAlvo: 1000, acumulado: 1500.5, prazoMeses: 2 }), agora).faltante).toBe(0);
  });
});

describe('faltante', () => {
  it('sai em centavos exatos, sem resto de ponto flutuante', () => {
    expect(projetarMeta(meta({ valorAlvo: 10000, acumulado: 9999.99, prazoMeses: 1 }), agora, 0).faltante).toBe(0.01);
    expect(projetarMeta(meta({ valorAlvo: 0.3, acumulado: 0.1, prazoMeses: 1 }), agora, 0).faltante).toBe(0.2);
  });

  it('linha sem aporte nem prazo (não passa pela entidade) não inventa projeção', () => {
    const corrompida = Meta.restaurar({ ...meta({ valorAlvo: 100, prazoMeses: 1 }).toSnapshot(), prazoMeses: null });
    expect(projetarMeta(corrompida, agora)).toEqual({
      faltante: 100,
      aporteNecessario: null,
      mesesEstimados: null,
      mesEstimado: null,
    });
  });
});
