import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { Divida, type DadosDivida } from './divida';

const agora = new Date('2026-09-17T12:00:00.000Z');

const dados = (overrides: Partial<DadosDivida> = {}): DadosDivida => ({
  tipo: 'emprestimo',
  saldo: 1500.1,
  parcela: 99.9,
  taxaAnual: 0.8765,
  ...overrides,
});

const criar = (overrides: Partial<DadosDivida> = {}) =>
  Divida.criar({ id: 'd1', subscriberId: 'sub-1', agora, ...dados(overrides) });

function detalhesDoErro(fn: () => unknown): Record<string, string> | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as ValidationError).details;
  }
  return expect.unreachable();
}

describe('Divida', () => {
  it('nasce com os dados validados, o dono e a data recebida', () => {
    expect(criar().toSnapshot()).toEqual({
      id: 'd1',
      subscriberId: 'sub-1',
      tipo: 'emprestimo',
      saldo: 1500.1,
      parcela: 99.9,
      taxaAnual: 0.8765,
      criadoEm: agora,
    });
  });

  it('parcela e taxa são opcionais: null fica null', () => {
    const d = criar({ parcela: null, taxaAnual: null });
    expect(d.parcela).toBeNull();
    expect(d.taxaAnual).toBeNull();
  });

  it('aceita centavos que o ponto flutuante complica (R$ 19,99, R$ 0,07) e taxa com 4 casas', () => {
    expect(criar({ saldo: 19.99, parcela: 0.07 }).toSnapshot()).toMatchObject({ saldo: 19.99, parcela: 0.07 });
    expect(criar({ taxaAnual: 0.1234 }).taxaAnual).toBe(0.1234);
  });

  it('aceita os extremos do motor: parcela 0, taxa 0 e taxa 20 (2.000% a.a.)', () => {
    expect(criar({ parcela: 0 }).parcela).toBe(0);
    expect(criar({ taxaAnual: 0 }).taxaAnual).toBe(0);
    expect(criar({ taxaAnual: 20 }).taxaAnual).toBe(20);
  });

  it.each<[string, Partial<DadosDivida>, Record<string, string>]>([
    ['tipo desconhecido', { tipo: 'cartao' as never }, { tipo: 'Escolha o tipo da dívida' }],
    ['saldo zero', { saldo: 0 }, { saldo: 'O saldo precisa ser maior que zero' }],
    ['saldo negativo', { saldo: -10 }, { saldo: 'O saldo precisa ser maior que zero' }],
    ['saldo acima do teto do motor', { saldo: 10_000_000.01 }, { saldo: 'Confere esse valor? Está muito alto' }],
    ['saldo com 3 casas', { saldo: 10.005 }, { saldo: 'No máximo 2 casas decimais' }],
    ['parcela negativa', { parcela: -1 }, { parcela: 'A parcela não pode ser negativa' }],
    ['parcela com 3 casas', { parcela: 1.005 }, { parcela: 'No máximo 2 casas decimais' }],
    ['taxa negativa', { taxaAnual: -0.01 }, { taxaAnual: 'A taxa não pode ser negativa' }],
    ['taxa acima de 20', { taxaAnual: 20.0001 }, { taxaAnual: 'Taxa acima de 2.000% ao ano? Confere o valor' }],
    ['taxa com 5 casas', { taxaAnual: 0.12345 }, { taxaAnual: 'No máximo 4 casas decimais' }],
  ])('recusa %s com a mensagem do campo', (_caso, overrides, detalhes) => {
    expect(detalhesDoErro(() => criar(overrides))).toEqual(detalhes);
  });

  describe('atualizar', () => {
    it('campo ausente (undefined) fica como está', () => {
      const d = criar();
      d.atualizar({ saldo: 1200 });
      expect(d.toSnapshot()).toMatchObject({ tipo: 'emprestimo', saldo: 1200, parcela: 99.9, taxaAnual: 0.8765 });
    });

    it('null limpa parcela e taxa', () => {
      const d = criar();
      d.atualizar({ parcela: null, taxaAnual: null });
      expect(d.parcela).toBeNull();
      expect(d.taxaAnual).toBeNull();
    });

    it('troca o tipo e preenche parcela e taxa que estavam vazias', () => {
      const d = criar({ parcela: null, taxaAnual: null });
      d.atualizar({ tipo: 'financiamento', parcela: 850.5, taxaAnual: 0.24 });
      expect(d.toSnapshot()).toMatchObject({ tipo: 'financiamento', parcela: 850.5, taxaAnual: 0.24 });
    });

    it('entrada inválida lança e não muda nada, nem os campos válidos que vieram junto', () => {
      const d = criar();
      const antes = d.toSnapshot();
      expect(detalhesDoErro(() => d.atualizar({ saldo: 500, taxaAnual: 21 }))).toHaveProperty('taxaAnual');
      expect(d.toSnapshot()).toEqual(antes);
    });

    it('ignora chaves extras: id, dono e data de criação não mudam', () => {
      const d = criar();
      const outraData = new Date('2020-01-01T00:00:00.000Z');
      d.atualizar({ saldo: 90, id: 'x', subscriberId: 'invasor', criadoEm: outraData } as never);
      expect(d.toSnapshot()).toMatchObject({ id: 'd1', subscriberId: 'sub-1', criadoEm: agora, saldo: 90 });
    });
  });

  it('restaurar reconstrói sem validar e guarda cópia: mexer nas props de origem não altera a entidade', () => {
    const props = { ...criar().toSnapshot(), criadoEm: new Date(agora) };
    const d = Divida.restaurar(props);
    props.saldo = 1;
    props.criadoEm.setFullYear(1990);
    expect(d.saldo).toBe(1500.1);
    expect(d.criadoEm).toEqual(agora);
  });

  it('toSnapshot devolve cópia profunda: mexer nela (data inclusive) não altera a entidade', () => {
    const d = criar();
    const snap = d.toSnapshot();
    snap.saldo = 1;
    snap.criadoEm.setFullYear(1990);
    expect(d.saldo).toBe(1500.1);
    expect(d.toSnapshot().criadoEm).toEqual(agora);
  });
});
