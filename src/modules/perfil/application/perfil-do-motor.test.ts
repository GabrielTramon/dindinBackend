import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { Categoria } from '../../categorias';
import { Divida } from '../../dividas';
import { GastoFixo } from '../../gastos-fixos';
import { Perfil } from '../domain/perfil';
import { montarPerfilDoMotor, resolverGastosDoMotor, type GastoResolvido } from './perfil-do-motor';

const agora = new Date('2026-09-17T12:00:00.000Z');

const catalogo = (slug: string, nome: string, grupo: Categoria['grupo'] = 'casa') =>
  Categoria.restaurar({ id: `cat-${slug}`, slug, nome, grupo, icone: 'X', ordem: 10, subscriberId: null, criadoEm: agora });

const CATALOGO = [
  catalogo('mercado', 'Mercado'),
  catalogo('condominio', 'Condomínio', 'moradia'),
  catalogo('academia', 'Academia', 'saude'),
  catalogo('outro', 'Outro', 'outros'),
];

const propria = (nome: string) => Categoria.criarPersonalizada({ id: `p-${nome}`, nome, subscriberId: 's1', agora });

const resumo = (r: GastoResolvido[]) =>
  r.map((g) => (g.tipo === 'existente' ? `${g.categoria.id}=${g.valor}` : `nova:${g.nome}=${g.valor}`));

describe('resolverGastosDoMotor', () => {
  it('slug do catálogo vira a categoria do catálogo', () => {
    expect(resumo(resolverGastosDoMotor([{ categoria: 'mercado', valor: 450 }], CATALOGO))).toEqual(['cat-mercado=450']);
  });

  it('dois "outro" com o mesmo nome (maiúsculas diferentes) viram uma linha, somada, com o primeiro nome', () => {
    const r = resolverGastosDoMotor(
      [
        { categoria: 'outro', nome: 'Clube', valor: 100 },
        { categoria: 'outro', nome: 'clube', valor: 50.5 },
      ],
      CATALOGO,
    );
    expect(resumo(r)).toEqual(['nova:Clube=150.5']);
  });

  it('"outro" com nome do catálogo usa o catálogo — inclusive moradia', () => {
    expect(resumo(resolverGastosDoMotor([{ categoria: 'outro', nome: 'condomínio', valor: 300 }], CATALOGO))).toEqual([
      'cat-condominio=300',
    ]);
  });

  it('slug e "outro" com o mesmo nome do catálogo se somam', () => {
    const r = resolverGastosDoMotor(
      [
        { categoria: 'mercado', valor: 400 },
        { categoria: 'outro', nome: 'MERCADO', valor: 50 },
      ],
      CATALOGO,
    );
    expect(resumo(r)).toEqual(['cat-mercado=450']);
  });

  it('reaproveita personalizada que a pessoa já tem', () => {
    expect(resumo(resolverGastosDoMotor([{ categoria: 'outro', nome: ' clube ', valor: 80 }], [...CATALOGO, propria('Clube')]))).toEqual(
      ['p-Clube=80'],
    );
  });

  it('soma sem erro de ponto flutuante', () => {
    const r = resolverGastosDoMotor(
      [
        { categoria: 'outro', nome: 'X', valor: 0.1 },
        { categoria: 'outro', nome: 'x', valor: 0.2 },
      ],
      CATALOGO,
    );
    expect(resumo(r)).toEqual(['nova:X=0.3']);
  });

  it('mantém a ordem da primeira ocorrência', () => {
    const r = resolverGastosDoMotor(
      [
        { categoria: 'academia', valor: 120 },
        { categoria: 'outro', nome: 'Clube', valor: 80 },
        { categoria: 'mercado', valor: 450 },
        { categoria: 'outro', nome: 'Academia', valor: 30 },
      ],
      CATALOGO,
    );
    expect(resumo(r)).toEqual(['cat-academia=150', 'nova:Clube=80', 'cat-mercado=450']);
  });

  it('"outro" sem nome → ValidationError no caminho da linha', () => {
    try {
      resolverGastosDoMotor([{ categoria: 'mercado', valor: 1 }, { categoria: 'outro', nome: '   ', valor: 10 }], CATALOGO);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toEqual({ 'gastosFixos.1.nome': 'Dê um nome pra categoria' });
    }
  });

  it('slug desconhecido → ValidationError no caminho da linha', () => {
    expect(() => resolverGastosDoMotor([{ categoria: 'jatinho', valor: 1 }], CATALOGO)).toThrow(ValidationError);
  });
});

describe('montarPerfilDoMotor', () => {
  it('ida e volta: catálogo vira slug, personalizada vira "outro" + nome, catálogo "Outro" também', () => {
    const perfil = Perfil.criar({
      subscriberId: 's1',
      rendaMensal: 2800,
      tipoRenda: 'clt',
      idade: 24,
      moradia: 'dividido',
      custoMoradia: 700,
      guardado: 1000,
      agora,
    });
    const clube = propria('Clube');
    const gastos = [
      GastoFixo.criar({ id: 'g1', subscriberId: 's1', categoriaId: 'cat-mercado', valor: 450, agora }),
      GastoFixo.criar({ id: 'g2', subscriberId: 's1', categoriaId: clube.id, valor: 80, agora }),
      GastoFixo.criar({ id: 'g3', subscriberId: 's1', categoriaId: 'cat-outro', valor: 10, agora }),
    ];
    const dividas = [
      Divida.criar({ id: 'd1', subscriberId: 's1', tipo: 'rotativo', saldo: 1500, parcela: null, taxaAnual: null, agora }),
    ];
    const porId = new Map([...CATALOGO, clube].map((c) => [c.id, c]));

    expect(montarPerfilDoMotor(perfil, gastos, porId, dividas)).toEqual({
      rendaMensal: 2800,
      tipoRenda: 'clt',
      idade: 24,
      moradia: 'dividido',
      custoMoradia: 700,
      guardado: 1000,
      gastosFixos: [
        { categoria: 'mercado', valor: 450 },
        { categoria: 'outro', nome: 'Clube', valor: 80 },
        { categoria: 'outro', nome: 'Outro', valor: 10 },
      ],
      dividas: [{ tipo: 'rotativo', saldo: 1500 }],
    });
  });
});
