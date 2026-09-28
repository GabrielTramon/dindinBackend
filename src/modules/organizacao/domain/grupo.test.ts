import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { MAX_GRUPOS, MAX_ITENS_POR_GRUPO, MAX_RENDIMENTO_MENSAL } from '../../../shared/motor/config';
import { ICONE_GRUPO_PADRAO } from '../../../shared/motor/metas-catalogo';
import { Grupo, TAMANHO_MAXIMO_NOME, validarOrganizacao, type ItemGrupoInput } from './grupo';

const agora = new Date('2026-09-18T12:00:00.000Z');

const criar = (patch: Partial<Parameters<typeof Grupo.criar>[0]> = {}) =>
  Grupo.criar({
    id: 'g-1',
    subscriberId: 'sub-1',
    nome: 'Investimento',
    valor: 800,
    ordem: 0,
    agora,
    ...patch,
  });

const itens = (...valores: number[]): ItemGrupoInput[] =>
  valores.map((valor, i) => ({ id: `i-${i}`, nome: `Item ${i}`, valor }));

describe('Grupo.criar', () => {
  it('guarda o que a pessoa organizou, com os padrões do catálogo', () => {
    const grupo = criar();
    expect(grupo.toSnapshot()).toEqual({
      id: 'g-1',
      subscriberId: 'sub-1',
      nome: 'Investimento',
      icone: ICONE_GRUPO_PADRAO,
      valor: 800,
      contaParaMeta: false,
      doSistema: false,
      ordem: 0,
      criadoEm: agora,
      itens: [],
    });
  });

  it('campo opcional ausente OMITE a chave — nunca vira null', () => {
    expect('rendimentoMensal' in criar().toSnapshot()).toBe(false);
    expect(criar().rendimentoMensal).toBeUndefined();
    expect(criar({ rendimentoMensal: 0.008 }).toSnapshot()).toMatchObject({ rendimentoMensal: 0.008 });
  });

  it('normaliza o nome e recusa vazio ou longo demais', () => {
    expect(criar({ nome: '  Eu   mesmo  ' }).nome).toBe('Eu mesmo');
    expect(() => criar({ nome: '   ' })).toThrow(ValidationError);
    expect(() => criar({ nome: 'x'.repeat(TAMANHO_MAXIMO_NOME + 1) })).toThrow('No máximo 40 caracteres');
    // o teto vale depois de aparar: 40 caracteres úteis entre espaços continuam válidos
    expect(criar({ nome: ` ${'x'.repeat(TAMANHO_MAXIMO_NOME)} ` }).nome).toHaveLength(TAMANHO_MAXIMO_NOME);
  });

  it('aceita ícone do catálogo do cliente e recusa lixo', () => {
    expect(criar({ icone: 'PiggyBank' }).icone).toBe('PiggyBank');
    // ícone que este backend ainda não conhece passa: o catálogo fechado é do cliente
    expect(criar({ icone: 'IconeQueOMotorAindaNaoTem' }).icone).toBe('IconeQueOMotorAindaNaoTem');
    expect(criar({ icone: '   ' }).icone).toBe(ICONE_GRUPO_PADRAO);
    expect(() => criar({ icone: '<img src=x>' })).toThrow('Ícone inválido');
  });

  it('valor: zero vale, negativo e centavo quebrado não', () => {
    expect(criar({ valor: 0 }).valor).toBe(0);
    expect(criar({ valor: 19.99 }).valor).toBe(19.99);
    expect(() => criar({ valor: -1 })).toThrow('O valor não pode ser negativo');
    expect(() => criar({ valor: 10.005 })).toThrow('No máximo 2 casas decimais');
    expect(() => criar({ valor: 99_999_999_999 })).toThrow(ValidationError);
  });

  it(`rendimento vai de 0 a ${MAX_RENDIMENTO_MENSAL}, com 4 casas`, () => {
    expect(criar({ rendimentoMensal: 0 }).rendimentoMensal).toBe(0);
    expect(criar({ rendimentoMensal: MAX_RENDIMENTO_MENSAL }).rendimentoMensal).toBe(MAX_RENDIMENTO_MENSAL);
    expect(() => criar({ rendimentoMensal: -0.001 })).toThrow('O rendimento não pode ser negativo');
    // o dedo a mais no teclado: 8% em vez de 0,8%
    expect(() => criar({ rendimentoMensal: 0.08 })).toThrow('O rendimento vai até 5% ao mês');
    expect(() => criar({ rendimentoMensal: 0.00085 })).toThrow('No máximo 4 casas decimais');
  });

  it('itens: guarda a ordem posicional recebida', () => {
    const grupo = criar({ itens: itens(300, 100) });
    expect(grupo.itens).toEqual([
      { id: 'i-0', nome: 'Item 0', valor: 300, ordem: 0 },
      { id: 'i-1', nome: 'Item 1', valor: 100, ordem: 1 },
    ]);
  });

  it(`itens: para em ${MAX_ITENS_POR_GRUPO} por grupo`, () => {
    expect(() => criar({ valor: 100, itens: itens(...Array(MAX_ITENS_POR_GRUPO + 1).fill(0)) })).toThrow(
      `No máximo ${MAX_ITENS_POR_GRUPO} itens por grupo`,
    );
  });

  it('itens: a soma não passa do valor do grupo, e o empate exato vale', () => {
    expect(criar({ valor: 800, itens: itens(500, 300) }).itens).toHaveLength(2);
    expect(() => criar({ valor: 800, itens: itens(500, 300.01) })).toThrow('A soma dos itens passou do valor do grupo');
    // somando em float, 0,1 + 0,2 daria 0,30000000000000004 e um grupo de 0,30 seria recusado
    expect(criar({ valor: 0.3, itens: itens(0.1, 0.2) }).itens).toHaveLength(2);
  });

  it('itens: id repetido dentro do grupo é erro, não "o último vence"', () => {
    const repetidos: ItemGrupoInput[] = [
      { id: 'i-1', nome: 'Viagem', valor: 100 },
      { id: 'i-1', nome: 'Presente', valor: 100 },
    ];
    const erro = (() => {
      try {
        criar({ itens: repetidos });
      } catch (e) {
        return e as ValidationError;
      }
    })();
    expect(erro).toBeInstanceOf(ValidationError);
    expect(erro?.details).toEqual({ 'itens.1.id': 'Esse item aparece duas vezes' });
  });

  it('o erro aponta o campo do item, com o caminho', () => {
    try {
      criar({ itens: [{ id: 'i-1', nome: 'Viagem', valor: 10.005 }] });
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).details).toEqual({ 'itens.0.valor': 'No máximo 2 casas decimais' });
    }
  });
});

describe('Grupo — encapsulamento', () => {
  it('mexer no que sai do getter não altera o grupo', () => {
    const grupo = criar({ itens: itens(100) });
    const copia = grupo.itens as unknown as { valor: number }[];
    copia[0]!.valor = 999;
    expect(grupo.itens[0]!.valor).toBe(100);
  });

  it('restaurar não valida e devolve cópia profunda', () => {
    const props = criar({ itens: itens(100) }).toSnapshot();
    const grupo = Grupo.restaurar(props);
    props.itens[0]!.valor = 999;
    expect(grupo.itens[0]!.valor).toBe(100);
    expect(grupo.pertenceA('sub-1')).toBe(true);
    expect(grupo.pertenceA('sub-2')).toBe(false);
  });

  it('restaurar com rendimentoMensal undefined não deixa a chave para trás', () => {
    const grupo = Grupo.restaurar({ ...criar().toSnapshot(), rendimentoMensal: undefined });
    expect('rendimentoMensal' in grupo.toSnapshot()).toBe(false);
  });
});

describe('validarOrganizacao', () => {
  const arvore = (quantidade: number, patch: (i: number) => Partial<Parameters<typeof Grupo.criar>[0]> = () => ({})) =>
    Array.from({ length: quantidade }, (_, i) => criar({ id: `g-${i}`, ordem: i, ...patch(i) }));

  it(`aceita até ${MAX_GRUPOS} grupos e recusa o seguinte`, () => {
    expect(() => validarOrganizacao(arvore(MAX_GRUPOS))).not.toThrow();
    expect(() => validarOrganizacao(arvore(MAX_GRUPOS + 1))).toThrow(`No máximo ${MAX_GRUPOS} grupos`);
  });

  it('id de grupo repetido → 400 com o índice, não "o último vence"', () => {
    const grupos = [criar({ id: 'g-1', ordem: 0 }), criar({ id: 'g-1', ordem: 1 })];
    try {
      validarOrganizacao(grupos);
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).details).toEqual({ 'grupos.1.id': 'Esse grupo aparece duas vezes' });
    }
  });

  it('só um grupo do sistema', () => {
    expect(() => validarOrganizacao(arvore(2, (i) => ({ doSistema: i === 0 })))).not.toThrow();
    expect(() => validarOrganizacao(arvore(2, () => ({ doSistema: true })))).toThrow('Só existe um grupo do sistema');
  });

  it('árvore vazia é válida: quem não organizou nada não está errado', () => {
    expect(() => validarOrganizacao([])).not.toThrow();
  });
});
