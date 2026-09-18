import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { METAS_TIPO, RENDAS_INFORMADAS, RITMOS } from '../../../shared/motor/schema';
import { moradiaSemCusto, Perfil, type DadosPerfil, type PerfilProps } from './perfil';

const agora = new Date('2026-09-17T12:00:00.000Z');
const depois = new Date('2026-09-18T08:30:00.000Z');

const dados: DadosPerfil = {
  rendaMensal: 2800.5,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1200,
  guardado: 1000,
};

/** as respostas posteriores à v1, todas preenchidas */
const NOVOS: Partial<DadosPerfil> = {
  rendaInformada: 'bruta',
  salarioBruto: 3500,
  dependentes: 2,
  competenciaTabela: '2026-01',
  ritmo: 'acelerado',
  meta: { tipo: 'carro', valorAlvo: 45_000.5 },
};

const criar = (sobrescrever: Partial<DadosPerfil> = {}) => Perfil.criar({ ...dados, ...sobrescrever, subscriberId: 's1', agora });

function erroDe(acao: () => unknown): ValidationError {
  try {
    acao();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return e as ValidationError;
  }
  return expect.unreachable();
}

describe('Perfil.criar', () => {
  it('monta o perfil com o dono e a data recebidos', () => {
    expect(criar().toSnapshot()).toEqual({ ...dados, subscriberId: 's1', atualizadoEm: agora });
  });

  // 19,99 e 1,10 eram recusados quando a checagem de casas multiplicava por 100
  it.each([19.99, 1.1, 0.07, 999_999.99])('aceita centavos no dinheiro (%s)', (valor) => {
    const p = criar({ rendaMensal: valor, custoMoradia: valor, guardado: valor });
    expect(p.toDados()).toMatchObject({ rendaMensal: valor, custoMoradia: valor, guardado: valor });
  });

  it.each<[Partial<DadosPerfil>, Record<string, string>]>([
    [{ rendaMensal: 0 }, { rendaMensal: 'A renda precisa ser maior que zero' }],
    [{ rendaMensal: 1_000_000.01 }, { rendaMensal: 'Confere esse valor? Está muito alto' }],
    [{ rendaMensal: 2800.005 }, { rendaMensal: 'No máximo 2 casas decimais' }],
    [{ tipoRenda: 'CLT' as never }, { tipoRenda: 'Escolha como é a sua renda' }],
    [{ idade: 13 }, { idade: 'A partir de 14 anos' }],
    [{ idade: 101 }, { idade: 'Confere a idade?' }],
    [{ idade: 24.5 }, { idade: 'Idade em anos inteiros' }],
    [{ moradia: 'barraca' as never }, { moradia: 'Escolha onde você mora' }],
    [{ custoMoradia: -1 }, { custoMoradia: 'Não pode ser negativo' }],
    [{ custoMoradia: 10.001 }, { custoMoradia: 'No máximo 2 casas decimais' }],
    [{ guardado: -0.01 }, { guardado: 'Não pode ser negativo' }],
    [{ guardado: Number.NaN }, { guardado: 'Informe quanto você tem guardado (pode ser 0)' }],
  ])('recusa %j com a mensagem do onboarding, no campo certo', (invalido, detalhes) => {
    expect(erroDe(() => criar(invalido)).details).toEqual(detalhes);
  });

  it.each(['pais', 'propria'] as const)('moradia sem custo (%s) zera o custo informado', (moradia) => {
    expect(moradiaSemCusto(moradia)).toBe(true);
    expect(criar({ moradia, custoMoradia: 900 }).custoMoradia).toBe(0);
  });

  it.each(['aluguel', 'dividido', 'financiada'] as const)('moradia com custo (%s) mantém o custo, inclusive 0', (moradia) => {
    expect(moradiaSemCusto(moradia)).toBe(false);
    expect(criar({ moradia, custoMoradia: 700 }).custoMoradia).toBe(700);
    expect(criar({ moradia, custoMoradia: 0 }).custoMoradia).toBe(0);
  });

  it('moradia sem custo ainda valida o custo que veio: negativo não passa calado', () => {
    expect(erroDe(() => criar({ moradia: 'pais', custoMoradia: -5 })).details).toEqual({
      custoMoradia: 'Não pode ser negativo',
    });
  });

  it('chaves extras na entrada não entram no perfil', () => {
    const p = Perfil.criar({ ...dados, subscriberId: 's1', agora, invasor: true } as never);
    expect(Object.keys(p.toSnapshot()).sort()).toEqual(
      ['atualizadoEm', 'custoMoradia', 'guardado', 'idade', 'moradia', 'rendaMensal', 'subscriberId', 'tipoRenda'],
    );
  });
});

describe('Perfil.atualizar', () => {
  it('aplica só os campos informados e renova atualizadoEm', () => {
    const p = criar();
    p.atualizar({ rendaMensal: 3100.9, idade: 25 }, depois);
    expect(p.toSnapshot()).toEqual({ ...dados, rendaMensal: 3100.9, idade: 25, subscriberId: 's1', atualizadoEm: depois });
  });

  it('undefined não mexe no campo', () => {
    const p = criar();
    p.atualizar({ rendaMensal: undefined, guardado: 50 }, depois);
    expect(p.toDados()).toEqual({ ...dados, guardado: 50 });
  });

  it('sair de moradia sem custo pra com custo exige informar o custo', () => {
    const p = criar({ moradia: 'pais', custoMoradia: 0 });
    expect(erroDe(() => p.atualizar({ moradia: 'aluguel' }, depois)).details).toEqual({
      custoMoradia: 'Informe quanto sai de moradia',
    });
    p.atualizar({ moradia: 'aluguel', custoMoradia: 0 }, depois);
    expect(p.toDados()).toMatchObject({ moradia: 'aluguel', custoMoradia: 0 });
  });

  it('entre moradias sem custo não precisa informar custo', () => {
    const p = criar({ moradia: 'pais' });
    p.atualizar({ moradia: 'propria' }, depois);
    expect(p.toDados()).toMatchObject({ moradia: 'propria', custoMoradia: 0 });
  });

  it('ir pra moradia sem custo zera o custo guardado', () => {
    const p = criar({ moradia: 'aluguel', custoMoradia: 1200 });
    p.atualizar({ moradia: 'pais' }, depois);
    expect(p.custoMoradia).toBe(0);
  });

  it('inválido lança e o perfil continua exatamente como estava', () => {
    const p = criar();
    const antes = p.toSnapshot();
    expect(erroDe(() => p.atualizar({ rendaMensal: 5000, idade: 7 }, depois)).details).toEqual({
      idade: 'A partir de 14 anos',
    });
    expect(p.toSnapshot()).toEqual(antes);
  });

  it('chaves extras (dono, data) são ignoradas', () => {
    const p = criar();
    p.atualizar({ idade: 30, subscriberId: 'invasor', atualizadoEm: new Date(0) } as never, depois);
    expect(p.toSnapshot()).toMatchObject({ subscriberId: 's1', idade: 30, atualizadoEm: depois });
  });
});

describe('Perfil — cópias', () => {
  it('restaurar reconstrói sem validar e copia fundo: mexer na origem não altera o perfil', () => {
    const props: PerfilProps = { ...dados, idade: 7, subscriberId: 's1', atualizadoEm: new Date(agora) };
    const p = Perfil.restaurar(props);
    props.rendaMensal = 1;
    props.atualizadoEm.setFullYear(1990);
    expect(p.idade).toBe(7);
    expect(p.rendaMensal).toBe(2800.5);
    expect(p.atualizadoEm).toEqual(agora);
  });

  it('toSnapshot devolve cópia profunda: mexer nela (inclusive na data) não altera o perfil', () => {
    const p = criar();
    const snap = p.toSnapshot();
    snap.subscriberId = 'invasor';
    snap.atualizadoEm.setFullYear(1990);
    expect(p.toSnapshot()).toEqual({ ...dados, subscriberId: 's1', atualizadoEm: agora });
  });

  it('toDados devolve só as respostas, sem dono nem data', () => {
    expect(criar().toDados()).toEqual(dados);
  });
});

/*
  As respostas posteriores à v1. Todas opcionais: por isso um campo esquecido
  em qualquer uma das listas campo a campo some SEM erro de compilação, e por
  isso cada teste daqui confere a chave, não só o valor.
*/
describe('Perfil — campos opcionais (renda bruta, ritmo e meta)', () => {
  it('criar leva todos os campos novos pro snapshot', () => {
    expect(criar(NOVOS).toSnapshot()).toEqual({ ...dados, ...NOVOS, subscriberId: 's1', atualizadoEm: agora });
  });

  it('perfil sem eles não ganha as chaves: nem no snapshot, nem em toDados', () => {
    const p = criar();
    const esperadas = ['custoMoradia', 'guardado', 'idade', 'moradia', 'rendaMensal', 'tipoRenda'];
    expect(Object.keys(p.toDados()).sort()).toEqual(esperadas);
    expect(Object.keys(p.toSnapshot()).sort()).toEqual([...esperadas, 'atualizadoEm', 'subscriberId'].sort());
    // toStrictEqual: `{ ritmo: undefined }` passaria no toEqual e viraria "ritmo": null no JSON
    expect(p.toDados()).toStrictEqual(dados);
  });

  it('toDados leva as chaves presentes e a meta vai copiada: mexer nela não altera o perfil', () => {
    const p = criar(NOVOS);
    const d = p.toDados();
    expect(d).toStrictEqual({ ...dados, ...NOVOS });

    d.meta!.valorAlvo = 1;
    d.meta!.tipo = 'casa';
    expect(p.toDados().meta).toEqual({ tipo: 'carro', valorAlvo: 45_000.5 });
    // o getter também devolve cópia
    p.meta!.valorAlvo = 2;
    expect(p.meta).toEqual({ tipo: 'carro', valorAlvo: 45_000.5 });
  });

  it.each(RITMOS)('aceita o ritmo %s', (ritmo) => {
    expect(criar({ ritmo }).ritmo).toBe(ritmo);
  });

  it.each(METAS_TIPO)('aceita a meta do tipo %s (com nome, que "outro" exige)', (tipo) => {
    expect(criar({ meta: { tipo, nome: 'Meu objetivo', valorAlvo: 1000 } }).meta).toEqual({
      tipo,
      nome: 'Meu objetivo',
      valorAlvo: 1000,
    });
  });

  it.each(RENDAS_INFORMADAS)('aceita rendaInformada %s (com o bruto junto)', (rendaInformada) => {
    expect(criar({ rendaInformada, salarioBruto: 3500 }).rendaInformada).toBe(rendaInformada);
  });

  it.each<[Partial<DadosPerfil>, Record<string, string>]>([
    [{ salarioBruto: 0 }, { salarioBruto: 'O salário precisa ser maior que zero' }],
    [{ salarioBruto: -1 }, { salarioBruto: 'O salário precisa ser maior que zero' }],
    [{ salarioBruto: 3500.005 }, { salarioBruto: 'No máximo 2 casas decimais' }],
    [{ salarioBruto: 1_000_000.01 }, { salarioBruto: 'Confere esse valor? Está muito alto' }],
    [{ dependentes: -1 }, { dependentes: 'Não pode ser negativo' }],
    [{ dependentes: 11 }, { dependentes: 'No máximo 10' }],
    [{ dependentes: 1.5 }, { dependentes: 'Em números inteiros' }],
    [{ competenciaTabela: '2026-13' }, { competenciaTabela: 'Competência no formato AAAA-MM' }],
    [{ competenciaTabela: 'janeiro/2026' }, { competenciaTabela: 'Competência no formato AAAA-MM' }],
    [{ competenciaTabela: '' }, { competenciaTabela: 'Competência no formato AAAA-MM' }],
    [{ meta: { tipo: 'carro', valorAlvo: 0 } }, { 'meta.valorAlvo': 'O valor precisa ser maior que zero' }],
    [{ meta: { tipo: 'carro', valorAlvo: 1000.005 } }, { 'meta.valorAlvo': 'No máximo 2 casas decimais' }],
    // a regra do metaSchema do motor, reaproveitada: meta "outro" sem nome é barra de progresso sem título
    [{ meta: { tipo: 'outro', valorAlvo: 1000 } }, { 'meta.nome': 'Dê um nome pra essa meta' }],
    [{ meta: { tipo: 'outro', nome: '   ', valorAlvo: 1000 } }, { 'meta.nome': 'Dê um nome pra essa meta' }],
  ])('recusa %j no campo certo', (invalido, detalhes) => {
    expect(erroDe(() => criar(invalido)).details).toEqual(detalhes);
  });

  it.each<[string, Partial<DadosPerfil>, string]>([
    ['ritmo fora da lista', { ritmo: 'agressivo' as never }, 'ritmo'],
    ['ritmo MAIÚSCULO, como no banco', { ritmo: 'ACELERADO' as never }, 'ritmo'],
    ['rendaInformada fora da lista', { rendaInformada: 'BRUTA' as never, salarioBruto: 1 }, 'rendaInformada'],
    ['tipo de meta fora do catálogo', { meta: { tipo: 'jatinho' as never, valorAlvo: 10 } }, 'meta.tipo'],
    ['competência que não é texto', { competenciaTabela: 202601 as never }, 'competenciaTabela'],
  ])('%s → ValidationError no campo', (_caso, invalido, campo) => {
    expect(erroDe(() => criar(invalido)).details).toHaveProperty([campo]);
  });

  /*
    Decisão documentada: rendaInformada "bruta" SEM salarioBruto é RECUSADA, não
    ignorada. Ignorar gravaria um perfil que se diz calculado e que ninguém
    consegue reconferir quando a tabela do imposto virar o ano.
  */
  it('rendaInformada "bruta" sem salarioBruto é recusada', () => {
    expect(erroDe(() => criar({ rendaInformada: 'bruta' })).details).toEqual({
      salarioBruto: 'Informe o seu salário bruto',
    });
  });

  it('o caminho inverso passa: quem digitou o líquido pode ter o bruto guardado como registro', () => {
    expect(criar({ rendaInformada: 'liquida', salarioBruto: 3500 }).toDados()).toMatchObject({
      rendaInformada: 'liquida',
      salarioBruto: 3500,
    });
    expect(criar({ salarioBruto: 3500 }).toDados()).toStrictEqual({ ...dados, salarioBruto: 3500 });
  });

  it('nome vazio em meta que não é "outro" some: guardar "" faria o perfil voltar diferente do que entrou', () => {
    const p = criar({ meta: { tipo: 'casa', nome: '  ', valorAlvo: 300_000 } });
    expect(p.toDados().meta).toStrictEqual({ tipo: 'casa', valorAlvo: 300_000 });
    // e o nome que existe é normalizado pelo schema do motor (trim)
    expect(criar({ meta: { tipo: 'outro', nome: '  Notebook  ', valorAlvo: 5000 } }).meta?.nome).toBe('Notebook');
  });

  it('atualizar troca o que veio e não mexe no que não veio', () => {
    const p = criar(NOVOS);
    p.atualizar({ ritmo: 'leve', meta: { tipo: 'viagem', valorAlvo: 9000 } }, depois);
    expect(p.toDados()).toStrictEqual({
      ...dados,
      ...NOVOS,
      ritmo: 'leve',
      meta: { tipo: 'viagem', valorAlvo: 9000 },
    });

    p.atualizar({ guardado: 50 }, depois);
    expect(p.toDados()).toMatchObject({ ritmo: 'leve', salarioBruto: 3500, guardado: 50 });
  });

  it('atualizar revalida o conjunto: tirar o bruto por PATCH é impossível, mas o par incoerente não cola', () => {
    const p = criar();
    expect(erroDe(() => p.atualizar({ rendaInformada: 'bruta' }, depois)).details).toEqual({
      salarioBruto: 'Informe o seu salário bruto',
    });
    expect(p.toDados()).toStrictEqual(dados);
  });

  it('substituir apaga o opcional ausente — é o que faz o PUT poder desfazer a escolha', () => {
    const p = criar(NOVOS);
    p.substituir(dados, depois);
    expect(p.toDados()).toStrictEqual(dados);
    expect(p.toSnapshot()).toStrictEqual({ ...dados, subscriberId: 's1', atualizadoEm: depois });
  });
});
