import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { gerarPlano } from '../../../shared/motor/motor';
import { MAX_VERSAO, normalizarComoJson, VersaoPlano, type PerfilDoMotor, type VersaoPlanoProps } from './versao-plano';

const agora = new Date('2026-09-17T12:00:00.000Z');

const PERFIL: PerfilDoMotor = {
  rendaMensal: 3200,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1100,
  gastosFixos: [
    { categoria: 'mercado', valor: 650 },
    { categoria: 'internet', valor: 99.9 },
    { categoria: 'outro', nome: 'Clube do bairro', valor: 45 },
  ],
  dividas: [{ tipo: 'rotativo', saldo: 1800, parcela: 150 }],
  guardado: 400,
};

// objetos novos a cada chamada: os testes mexem na origem de propósito
const props = (sobrescrever: Partial<VersaoPlanoProps> = {}): VersaoPlanoProps => ({
  id: 'v1',
  subscriberId: 's1',
  versao: 1,
  inputSnap: structuredClone(PERFIL),
  resultado: gerarPlano(structuredClone(PERFIL)),
  criadoEm: new Date(agora),
  ...sobrescrever,
});

describe('VersaoPlano', () => {
  it('criar guarda a entrada e o resultado do motor como vieram', () => {
    const v = VersaoPlano.criar(props());
    expect(v.toSnapshot()).toEqual(props());
    expect(v.resultado.perfil).toEqual(v.inputSnap);
  });

  it.each([0, -1, 1.5, Number.NaN, MAX_VERSAO + 1])('versão inválida %j', (versao) => {
    try {
      VersaoPlano.criar(props({ versao }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toEqual({ versao: 'Versão inválida' });
    }
  });

  it('aceita a maior versão que cabe no banco', () => {
    expect(VersaoPlano.criar(props({ versao: MAX_VERSAO })).versao).toBe(MAX_VERSAO);
  });

  it('criar normaliza como o JSONB devolve: chave undefined some e -0 vira 0', () => {
    const comUndefined = {
      ...PERFIL,
      guardado: -0,
      dividas: [{ tipo: 'rotativo' as const, saldo: 1800, parcela: undefined, taxaAnual: undefined }],
    };
    const snap = VersaoPlano.criar(props({ inputSnap: comUndefined })).toSnapshot();
    expect(Object.keys(snap.inputSnap.dividas[0]!)).toEqual(['tipo', 'saldo']);
    expect(Object.is(snap.inputSnap.guardado, 0)).toBe(true);
  });

  it('criar monta campo a campo: chave extra não entra na versão', () => {
    const v = VersaoPlano.criar({ ...props(), dono: 'invasor' } as never);
    expect(Object.keys(v.toSnapshot()).sort()).toEqual(['criadoEm', 'id', 'inputSnap', 'resultado', 'subscriberId', 'versao']);
  });

  it('criar copia a entrada: mexer no objeto de origem depois não altera a versão', () => {
    const origem = props();
    const v = VersaoPlano.criar(origem);
    origem.inputSnap.gastosFixos[0]!.valor = 1;
    origem.resultado.decisao.titulo = 'Outro';
    origem.criadoEm.setFullYear(1990);
    expect(v.inputSnap.gastosFixos[0]!.valor).toBe(650);
    expect(v.resultado.decisao.titulo).not.toBe('Outro');
    expect(v.criadoEm).toEqual(agora);
  });

  it('restaurar copia: mexer nas props depois não altera a versão', () => {
    const origem = props();
    const v = VersaoPlano.restaurar(origem);
    origem.inputSnap.guardado = 999;
    expect(v.inputSnap.guardado).toBe(400);
  });

  it('é imutável: getters e snapshot devolvem cópias', () => {
    const v = VersaoPlano.criar(props());
    v.inputSnap.dividas.push({ tipo: 'outra', saldo: 1 });
    v.resultado.alocacoes.length = 0;
    v.toSnapshot().inputSnap.rendaMensal = 1;
    v.criadoEm.setFullYear(1990);
    expect(v.toSnapshot()).toEqual(props());
  });

  it('normalizarComoJson devolve cópia e não mexe no original', () => {
    const original = { a: 1, b: undefined, c: [{ d: -0 }] };
    const normalizado = normalizarComoJson(original);
    expect(normalizado).not.toBe(original);
    expect('b' in normalizado).toBe(false);
    expect('b' in original).toBe(true);
  });
});
