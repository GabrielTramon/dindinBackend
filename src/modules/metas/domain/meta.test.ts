import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ValidationError } from '../../../shared/domain/errors';
import { MAX_MONEY } from '../../../shared/domain/guards';
import { Meta, PRAZO_MAXIMO_MESES, TAMANHO_MAXIMO_NOME_META } from './meta';

const agora = new Date('2026-09-17T12:00:00.000Z');
const depois = new Date('2026-09-18T08:30:00.000Z');
/** o mínimo pra Meta.criar; cada teste completa com o que está exercitando */
const base = { id: 'm', subscriberId: 's', nome: 'X', valorAlvo: 10, agora };

const comAporte = () =>
  Meta.criar({ id: 'm1', subscriberId: 'sub-1', nome: 'Viagem', valorAlvo: 10000, aporteMensal: 500, agora });

const comPrazo = () =>
  Meta.criar({ id: 'm2', subscriberId: 'sub-1', nome: 'Reserva', valorAlvo: 6000, prazoMeses: 12, acumulado: 1000, agora });

function detalhesDoErro(fn: () => unknown): Record<string, string> | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as ValidationError).details;
  }
  return expect.unreachable();
}

describe('Meta.criar', () => {
  it('nasce sem slug público, com acumulado 0 e as duas datas iguais a agora', () => {
    expect(comAporte().toSnapshot()).toEqual({
      id: 'm1',
      subscriberId: 'sub-1',
      nome: 'Viagem',
      valorAlvo: 10000,
      aporteMensal: 500,
      prazoMeses: null,
      acumulado: 0,
      publicSlug: null,
      criadoEm: agora,
      atualizadoEm: agora,
    });
  });

  it('normaliza espaços do nome', () => {
    const m = Meta.criar({ ...base, nome: '  Viagem   pro  Japão ', prazoMeses: 1 });
    expect(m.nome).toBe('Viagem pro Japão');
  });

  it('aceita centavos no valor alvo, no aporte e no acumulado', () => {
    const m = Meta.criar({ ...base, valorAlvo: 19.99, aporteMensal: 1.1, acumulado: 0.07 });
    expect([m.valorAlvo, m.aporteMensal, m.acumulado]).toEqual([19.99, 1.1, 0.07]);
  });

  it.each([
    ['', 'Dê um nome pra meta'],
    ['   ', 'Dê um nome pra meta'],
    ['x'.repeat(TAMANHO_MAXIMO_NOME_META + 1), `No máximo ${TAMANHO_MAXIMO_NOME_META} caracteres`],
  ])('nome inválido %j', (nome, mensagem) => {
    expect(detalhesDoErro(() => Meta.criar({ ...base, nome, prazoMeses: 1 }))).toEqual({ nome: mensagem });
  });

  it.each([0, -1, 10.005, MAX_MONEY + 1, Number.NaN])('valor alvo inválido %s', (valorAlvo) => {
    expect(detalhesDoErro(() => Meta.criar({ ...base, valorAlvo, prazoMeses: 1 }))).toHaveProperty('valorAlvo');
  });

  it.each([-0.01, 1.001])('acumulado inválido %s', (acumulado) => {
    expect(detalhesDoErro(() => Meta.criar({ ...base, prazoMeses: 1, acumulado }))).toHaveProperty('acumulado');
  });

  it.each([0, -5, 0.001])('aporte inválido %s', (aporteMensal) => {
    expect(detalhesDoErro(() => Meta.criar({ ...base, aporteMensal }))).toEqual({
      aporteMensal: 'Informe um aporte maior que zero, com até 2 casas',
    });
  });

  it.each([0, PRAZO_MAXIMO_MESES + 1, 1.5])('prazo inválido %s', (prazoMeses) => {
    expect(detalhesDoErro(() => Meta.criar({ ...base, prazoMeses }))).toEqual({
      prazoMeses: `O prazo vai de 1 a ${PRAZO_MAXIMO_MESES} meses`,
    });
  });

  it('aceita o prazo nos dois extremos', () => {
    for (const prazoMeses of [1, PRAZO_MAXIMO_MESES]) {
      expect(Meta.criar({ ...base, prazoMeses }).prazoMeses).toBe(prazoMeses);
    }
  });

  it('aporte e prazo juntos, ou nenhum dos dois, é regra de negócio com detalhe nos dois campos', () => {
    for (const extra of [{ aporteMensal: 10, prazoMeses: 3 }, {}, { aporteMensal: null, prazoMeses: null }]) {
      try {
        Meta.criar({ ...base, ...extra });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(BusinessRuleError);
        expect(Object.keys((e as BusinessRuleError).details ?? {}).sort()).toEqual(['aporteMensal', 'prazoMeses']);
      }
    }
  });
});

describe('progresso e atingida', () => {
  const com = (valorAlvo: number, acumulado: number) =>
    Meta.restaurar({ ...comAporte().toSnapshot(), valorAlvo, acumulado });

  it('fração truncada em 4 casas', () => {
    expect(com(10000, 0).progresso).toBe(0);
    expect(com(10000, 2500).progresso).toBe(0.25);
    expect(com(3, 1).progresso).toBe(0.3333);
    expect(com(3, 2).progresso).toBe(0.6666);
  });

  it('só chega a 1 quando atinge; passar do alvo continua 1', () => {
    expect(com(10000, 9999.99).progresso).toBe(0.9999);
    expect(com(10000, 9999.99).atingida).toBe(false);
    expect(com(10000, 10000).progresso).toBe(1);
    expect(com(10000, 10000).atingida).toBe(true);
    expect(com(10000, 15000).progresso).toBe(1);
  });
});

describe('Meta.atualizar', () => {
  it('muda só os campos informados e avança atualizadoEm', () => {
    const m = comAporte();
    m.atualizar({ acumulado: 1234.56 }, depois);
    expect(m.toSnapshot()).toMatchObject({ nome: 'Viagem', valorAlvo: 10000, aporteMensal: 500, acumulado: 1234.56 });
    expect(m.criadoEm).toEqual(agora);
    expect(m.atualizadoEm).toEqual(depois);
  });

  it('troca aporte por prazo mandando o novo e null no outro — e volta', () => {
    const m = comAporte();
    m.atualizar({ prazoMeses: 24, aporteMensal: null }, depois);
    expect([m.aporteMensal, m.prazoMeses]).toEqual([null, 24]);
    m.atualizar({ aporteMensal: 300, prazoMeses: null }, depois);
    expect([m.aporteMensal, m.prazoMeses]).toEqual([300, null]);
  });

  it('mandar só o prazo numa meta com aporte deixa os dois: BusinessRuleError e nada muda', () => {
    const m = comAporte();
    const antes = m.toSnapshot();
    expect(() => m.atualizar({ prazoMeses: 12 }, depois)).toThrow(BusinessRuleError);
    expect(m.toSnapshot()).toEqual(antes);
  });

  it('tirar os dois é BusinessRuleError', () => {
    expect(() => comPrazo().atualizar({ prazoMeses: null }, depois)).toThrow(BusinessRuleError);
  });

  it('valor inválido no meio de campos válidos não aplica nenhum', () => {
    const m = comPrazo();
    const antes = m.toSnapshot();
    expect(() => m.atualizar({ nome: 'Outro nome', valorAlvo: 10.001 }, depois)).toThrow(ValidationError);
    expect(m.toSnapshot()).toEqual(antes);
  });

  it('undefined conta como "não mexer"', () => {
    const m = comPrazo();
    m.atualizar({ nome: 'Reserva de emergência', prazoMeses: undefined, aporteMensal: undefined }, depois);
    expect(m.toSnapshot()).toMatchObject({ nome: 'Reserva de emergência', prazoMeses: 12, aporteMensal: null });
  });

  it('ignora chaves extras: id, dono, slug e datas não mudam', () => {
    const m = comAporte();
    m.publicar('viagem-abc123', agora);
    m.atualizar(
      { nome: 'Outra', id: 'x', subscriberId: 'invasor', publicSlug: 'roubado', criadoEm: depois } as never,
      depois,
    );
    expect(m.toSnapshot()).toMatchObject({
      id: 'm1',
      subscriberId: 'sub-1',
      publicSlug: 'viagem-abc123',
      criadoEm: agora,
      nome: 'Outra',
    });
  });
});

describe('Meta.publicar e despublicar', () => {
  it('publica com slug válido e avança atualizadoEm', () => {
    const m = comAporte();
    m.publicar('viagem-abc123', depois);
    expect(m.publicSlug).toBe('viagem-abc123');
    expect(m.atualizadoEm).toEqual(depois);
  });

  it.each(['abcd', 'a'.repeat(50), 'a--b', '2026-carro-x1y2z3'])('aceita %j', (slug) => {
    expect(() => comAporte().publicar(slug, depois)).not.toThrow();
  });

  it.each(['abc', 'a'.repeat(51), '-abcd', 'abcd-', 'Viagem-abc', 'via gem-abc', 'viagem_abc', 'viágem-abc', ''])(
    'recusa %j sem mexer na meta',
    (slug) => {
      const m = comAporte();
      expect(detalhesDoErro(() => m.publicar(slug, depois))).toEqual({ publicSlug: 'Endereço público inválido' });
      expect(m.publicSlug).toBeNull();
      expect(m.atualizadoEm).toEqual(agora);
    },
  );

  it('despublicar tira o slug e avança atualizadoEm', () => {
    const m = comAporte();
    m.publicar('viagem-abc123', agora);
    m.despublicar(depois);
    expect(m.publicSlug).toBeNull();
    expect(m.atualizadoEm).toEqual(depois);
  });

  it('despublicar o que não está publicado não mexe em nada', () => {
    const m = comAporte();
    m.despublicar(depois);
    expect(m.atualizadoEm).toEqual(agora);
  });
});

describe('cópias', () => {
  it('restaurar e toSnapshot copiam fundo, datas inclusive', () => {
    const props = comAporte().toSnapshot();
    const m = Meta.restaurar(props);
    props.nome = 'Mexido';
    props.criadoEm.setFullYear(1990);
    expect(m.nome).toBe('Viagem');
    expect(m.criadoEm).toEqual(agora);

    const snap = m.toSnapshot();
    snap.atualizadoEm.setFullYear(1990);
    snap.acumulado = 999;
    expect(m.atualizadoEm).toEqual(agora);
    expect(m.acumulado).toBe(0);
  });
});
