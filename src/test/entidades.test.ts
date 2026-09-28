import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ValidationError } from '../shared/domain/errors';
import { Divida } from '../modules/dividas';
import { GastoFixo } from '../modules/gastos-fixos';
import { Meta } from '../modules/metas';
import { Perfil } from '../modules/perfil';
import { VersaoPlano } from '../modules/planos';

/*
  Regressões das entidades apontadas na revisão da fundação: dinheiro com
  centavos, chaves extras que trocavam o dono, progresso arredondado pra cima,
  moradia que pulava validação e cópia rasa no plano "imutável".
*/

const agora = new Date('2026-09-17T12:00:00.000Z');

describe('Meta', () => {
  const meta = () => Meta.criar({ id: 'm1', subscriberId: 's1', nome: 'Viagem', valorAlvo: 19.99, prazoMeses: 12, agora });

  it('aceita centavos (R$ 19,99)', () => {
    expect(meta().valorAlvo).toBe(19.99);
  });

  it('atualizar ignora chaves extras: dono, id e slug público não mudam', () => {
    const m = meta();
    const malicioso = { nome: 'Outra', subscriberId: 'invasor', id: 'x', publicSlug: 'roubado' } as never;
    m.atualizar(malicioso, agora);
    expect(m.toSnapshot()).toMatchObject({ id: 'm1', subscriberId: 's1', publicSlug: null, nome: 'Outra' });
  });

  it('meta restaurada com acumulado de centavos continua editável', () => {
    const m = Meta.restaurar({ ...meta().toSnapshot(), acumulado: 0.07 });
    expect(() => m.atualizar({ nome: 'Nova' }, agora)).not.toThrow();
  });

  it('progresso só chega a 100% quando atingida', () => {
    const quase = Meta.restaurar({ ...meta().toSnapshot(), valorAlvo: 10000, acumulado: 9999.99 });
    expect(quase.atingida).toBe(false);
    expect(quase.progresso).toBeLessThan(1);
    expect(Meta.restaurar({ ...meta().toSnapshot(), valorAlvo: 100, acumulado: 100 }).progresso).toBe(1);
  });

  it('aporte e prazo juntos (ou nenhum) é regra de negócio', () => {
    expect(() =>
      Meta.criar({ id: 'm', subscriberId: 's', nome: 'X', valorAlvo: 10, aporteMensal: 1, prazoMeses: 2, agora }),
    ).toThrow(BusinessRuleError);
    expect(() => Meta.criar({ id: 'm', subscriberId: 's', nome: 'X', valorAlvo: 10, agora })).toThrow(BusinessRuleError);
  });
});

describe('Perfil', () => {
  const base = {
    subscriberId: 's1',
    rendaMensal: 2800.5,
    tipoRenda: 'clt' as const,
    idade: 24,
    moradia: 'pais' as const,
    custoMoradia: 0,
    guardado: 0,
    agora,
  };

  it('recusa 3 casas no dinheiro (o banco arredondaria calado)', () => {
    expect(() => Perfil.criar({ ...base, rendaMensal: 2800.005 })).toThrow(ValidationError);
  });

  it('moradia sem custo zera o custo, mas valida o que veio', () => {
    expect(Perfil.criar({ ...base, custoMoradia: 500 }).custoMoradia).toBe(0);
    expect(() => Perfil.criar({ ...base, custoMoradia: -1 })).toThrow(ValidationError);
  });

  it('sair de moradia sem custo pra com custo exige informar o custo', () => {
    const p = Perfil.criar(base);
    expect(() => p.atualizar({ moradia: 'aluguel' }, agora)).toThrow(ValidationError);
    p.atualizar({ moradia: 'aluguel', custoMoradia: 1200 }, agora);
    expect(p.toDados()).toMatchObject({ moradia: 'aluguel', custoMoradia: 1200 });
  });

  it('atualizar ignora chaves extras', () => {
    const p = Perfil.criar(base);
    p.atualizar({ idade: 25, subscriberId: 'invasor' } as never, agora);
    expect(p.subscriberId).toBe('s1');
    expect(p.idade).toBe(25);
  });
});

describe('GastoFixo e Divida', () => {
  it('gasto aceita centavos e recusa 3 casas', () => {
    expect(GastoFixo.criar({ id: 'g', subscriberId: 's', categoriaId: 'c', valor: 19.99, agora }).valor).toBe(19.99);
    expect(() => GastoFixo.criar({ id: 'g', subscriberId: 's', categoriaId: 'c', valor: 1.005, agora })).toThrow(
      ValidationError,
    );
  });

  it('dívida: 2 casas no dinheiro, 4 na taxa, null limpa parcela', () => {
    const d = Divida.criar({ id: 'd', subscriberId: 's', tipo: 'emprestimo', saldo: 1500.1, parcela: 99.9, taxaAnual: 0.8765, agora });
    expect(() => d.atualizar({ saldo: 10.001 })).toThrow(ValidationError);
    expect(() => d.atualizar({ taxaAnual: 0.12345 })).toThrow(ValidationError);
    d.atualizar({ parcela: null });
    expect(d.parcela).toBeNull();
  });

  it('dívida.atualizar ignora chaves extras', () => {
    const d = Divida.criar({ id: 'd', subscriberId: 's', tipo: 'rotativo', saldo: 100, parcela: null, taxaAnual: null, agora });
    d.atualizar({ saldo: 90, subscriberId: 'invasor', id: 'x' } as never);
    expect(d.toSnapshot()).toMatchObject({ id: 'd', subscriberId: 's', saldo: 90 });
  });
});

describe('VersaoPlano', () => {
  it('é imutável de verdade: mexer no que sai dos getters ou do snapshot não altera a versão', () => {
    const v = VersaoPlano.criar({
      id: 'v1',
      subscriberId: 's1',
      versao: 1,
      inputSnap: { gastosFixos: [{ categoria: 'mercado', valor: 1 }] } as never,
      resultado: { degrau: 0 } as never,
      criadoEm: agora,
    });
    (v.inputSnap as { gastosFixos: { valor: number }[] }).gastosFixos[0]!.valor = 999;
    (v.toSnapshot().resultado as { degrau: number }).degrau = 4;
    v.criadoEm.setFullYear(1990);
    expect((v.inputSnap as { gastosFixos: { valor: number }[] }).gastosFixos[0]!.valor).toBe(1);
    expect((v.resultado as { degrau: number }).degrau).toBe(0);
    expect(v.criadoEm).toEqual(agora);
  });
});
