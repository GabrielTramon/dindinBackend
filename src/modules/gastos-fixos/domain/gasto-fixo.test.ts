import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { GastoFixo, type GastoFixoProps } from './gasto-fixo';

const agora = new Date('2026-09-17T12:00:00.000Z');

const criar = (valor: number) => GastoFixo.criar({ id: 'g1', subscriberId: 'sub-1', categoriaId: 'categoria-mercado', valor, agora });

function erroDeValor(acao: () => unknown): ValidationError {
  try {
    acao();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return e as ValidationError;
  }
  return expect.unreachable();
}

describe('GastoFixo', () => {
  it('criar monta o gasto com o dono, a categoria e a data recebidos', () => {
    expect(criar(450).toSnapshot()).toEqual({
      id: 'g1',
      subscriberId: 'sub-1',
      categoriaId: 'categoria-mercado',
      valor: 450,
      criadoEm: agora,
    });
  });

  // 19,99 e 1,10 eram recusados quando a checagem multiplicava por 100
  it.each([19.99, 1.1, 0.07, 0.01, 1_000_000])('aceita %s', (valor) => {
    expect(criar(valor).valor).toBe(valor);
  });

  it.each([
    [0, 'O valor precisa ser maior que zero'],
    [-10, 'O valor precisa ser maior que zero'],
    [1_000_000.01, 'Confere esse valor? Está muito alto'],
    [10.005, 'No máximo 2 casas decimais'],
    [Number.NaN, 'Informe quanto sai por mês'],
  ])('recusa valor %s com a mensagem do onboarding', (valor, mensagem) => {
    const erro = erroDeValor(() => criar(valor));
    expect(erro.details).toEqual({ valor: mensagem });
  });

  it('alterarValor troca o valor validado', () => {
    const gasto = criar(450);
    gasto.alterarValor(479.9);
    expect(gasto.valor).toBe(479.9);
  });

  it('alterarValor inválido lança e mantém o valor anterior', () => {
    const gasto = criar(450);
    const erro = erroDeValor(() => gasto.alterarValor(0.001));
    expect(erro.details).toEqual({ valor: 'No máximo 2 casas decimais' });
    expect(gasto.valor).toBe(450);
  });

  it('restaurar reconstrói sem validar e copia as props: mexer no objeto de origem não altera o gasto', () => {
    const props: GastoFixoProps = { id: 'g1', subscriberId: 'sub-1', categoriaId: 'c', valor: 10, criadoEm: new Date(agora) };
    const gasto = GastoFixo.restaurar(props);
    props.valor = 999;
    props.criadoEm.setFullYear(1990);
    expect(gasto.valor).toBe(10);
    expect(gasto.criadoEm).toEqual(agora);
  });

  it('toSnapshot devolve cópia profunda: mexer nela (inclusive na data) não altera o gasto', () => {
    const gasto = criar(450);
    const snap = gasto.toSnapshot();
    snap.valor = 1;
    snap.subscriberId = 'invasor';
    snap.criadoEm.setFullYear(1990);
    expect(gasto.toSnapshot()).toEqual({
      id: 'g1',
      subscriberId: 'sub-1',
      categoriaId: 'categoria-mercado',
      valor: 450,
      criadoEm: agora,
    });
  });
});
