import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { FixedClock } from '../../../shared/infra/in-memory/doubles';
import { MAX_GRUPOS, MAX_ITENS_POR_GRUPO } from '../../../shared/motor/config';
import { ICONE_GRUPO_PADRAO } from '../../../shared/motor/metas-catalogo';
import { InMemoryGruposRepository } from '../infra/database/in-memory-grupos-repository';
import { ObterOrganizacaoUseCase } from './obter-organizacao.use-case';
import { SalvarOrganizacaoUseCase, type GrupoEntrada } from './salvar-organizacao.use-case';

let repo: InMemoryGruposRepository;
let clock: FixedClock;
let obter: ObterOrganizacaoUseCase;
let salvar: SalvarOrganizacaoUseCase;

beforeEach(() => {
  repo = new InMemoryGruposRepository();
  clock = new FixedClock();
  obter = new ObterOrganizacaoUseCase(repo);
  salvar = new SalvarOrganizacaoUseCase(repo, clock);
});

const entrada = (patch: Partial<GrupoEntrada> = {}): GrupoEntrada => ({
  id: 'g-1',
  nome: 'Investimento',
  valor: 800,
  ...patch,
});

const detalhes = async (promessa: Promise<unknown>) => {
  try {
    await promessa;
    return expect.unreachable('devia ter falhado');
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).details;
  }
};

describe('ObterOrganizacaoUseCase', () => {
  it('quem nunca organizou nada recebe lista vazia, não erro', async () => {
    expect(await obter.execute({ subscriberId: 'sub-1' })).toEqual([]);
  });

  it('não enxerga a árvore de outra pessoa', async () => {
    await salvar.execute({ subscriberId: 'sub-1', grupos: [entrada()] });
    expect(await obter.execute({ subscriberId: 'sub-2' })).toEqual([]);
  });
});

describe('SalvarOrganizacaoUseCase', () => {
  it('grava a árvore e devolve o que ficou gravado', async () => {
    const salvos = await salvar.execute({
      subscriberId: 'sub-1',
      grupos: [
        entrada({ id: 'g-1', nome: 'Guardar', icone: 'PiggyBank', valor: 840, doSistema: true }),
        entrada({
          id: 'g-2',
          nome: 'Investimento',
          valor: 800,
          contaParaMeta: true,
          rendimentoMensal: 0.008,
          itens: [{ id: 'i-1', nome: 'Viagem', valor: 300 }],
        }),
      ],
    });

    expect(salvos.map((g) => g.nome)).toEqual(['Guardar', 'Investimento']);
    const lidos = await obter.execute({ subscriberId: 'sub-1' });
    expect(lidos.map((g) => g.toSnapshot())).toEqual(salvos.map((g) => g.toSnapshot()));
  });

  it('a ordem é posicional: grava o índice recebido e devolve nessa ordem', async () => {
    await salvar.execute({
      subscriberId: 'sub-1',
      grupos: [entrada({ id: 'g-1', nome: 'Zebra' }), entrada({ id: 'g-2', nome: 'Abacate' })],
    });

    const lidos = await obter.execute({ subscriberId: 'sub-1' });
    expect(lidos.map((g) => [g.nome, g.ordem])).toEqual([
      ['Zebra', 0],
      ['Abacate', 1],
    ]);
  });

  it('substitui a árvore inteira: o grupo que não veio some', async () => {
    await salvar.execute({
      subscriberId: 'sub-1',
      grupos: [entrada({ id: 'g-1' }), entrada({ id: 'g-2', nome: 'Namoro' })],
    });
    await salvar.execute({ subscriberId: 'sub-1', grupos: [entrada({ id: 'g-2', nome: 'Namoro' })] });

    expect((await obter.execute({ subscriberId: 'sub-1' })).map((g) => g.id)).toEqual(['g-2']);
  });

  it('lista vazia limpa a organização', async () => {
    await salvar.execute({ subscriberId: 'sub-1', grupos: [entrada()] });
    await salvar.execute({ subscriberId: 'sub-1', grupos: [] });
    expect(await obter.execute({ subscriberId: 'sub-1' })).toEqual([]);
  });

  it('nunca grava na árvore de outra pessoa, mesmo com o mesmo id de grupo', async () => {
    await salvar.execute({ subscriberId: 'sub-1', grupos: [entrada({ id: 'g-1', nome: 'Da 1' })] });
    await salvar.execute({ subscriberId: 'sub-2', grupos: [entrada({ id: 'g-1', nome: 'Da 2' })] });

    expect((await obter.execute({ subscriberId: 'sub-1' }))[0]!.nome).toBe('Da 1');
    expect((await obter.execute({ subscriberId: 'sub-2' }))[0]!.nome).toBe('Da 2');
  });

  it('o padrão do grupo é: ícone genérico, não conta pra meta, não é do sistema, sem rendimento', async () => {
    const [grupo] = await salvar.execute({ subscriberId: 'sub-1', grupos: [entrada()] });
    expect(grupo!.icone).toBe(ICONE_GRUPO_PADRAO);
    expect(grupo!.contaParaMeta).toBe(false);
    expect(grupo!.doSistema).toBe(false);
    expect(grupo!.rendimentoMensal).toBeUndefined();
  });

  it('não valida contra a base: somar muito acima do excedente é um estado válido', async () => {
    const grupos = Array.from({ length: MAX_GRUPOS }, (_, i) => entrada({ id: `g-${i}`, valor: 1_000_000 }));
    await expect(salvar.execute({ subscriberId: 'sub-1', grupos })).resolves.toHaveLength(MAX_GRUPOS);
  });

  it(`para em ${MAX_GRUPOS} grupos`, async () => {
    const grupos = Array.from({ length: MAX_GRUPOS + 1 }, (_, i) => entrada({ id: `g-${i}` }));
    expect(await detalhes(salvar.execute({ subscriberId: 'sub-1', grupos }))).toEqual({
      grupos: `No máximo ${MAX_GRUPOS} grupos — o "Guardar" conta`,
    });
  });

  it('id de grupo repetido → 400 e nada é gravado', async () => {
    await salvar.execute({ subscriberId: 'sub-1', grupos: [entrada({ id: 'antigo' })] });

    expect(
      await detalhes(
        salvar.execute({ subscriberId: 'sub-1', grupos: [entrada({ id: 'g-1' }), entrada({ id: 'g-1' })] }),
      ),
    ).toEqual({ 'grupos.1.id': 'Esse grupo aparece duas vezes' });
    expect((await obter.execute({ subscriberId: 'sub-1' })).map((g) => g.id)).toEqual(['antigo']);
  });

  it('dois grupos do sistema → 400', async () => {
    expect(
      await detalhes(
        salvar.execute({
          subscriberId: 'sub-1',
          grupos: [entrada({ id: 'g-1', doSistema: true }), entrada({ id: 'g-2', doSistema: true })],
        }),
      ),
    ).toEqual({ grupos: 'Só existe um grupo do sistema (o "Guardar")' });
  });

  it('o erro de um item aponta o caminho completo, com o índice do grupo', async () => {
    expect(
      await detalhes(
        salvar.execute({
          subscriberId: 'sub-1',
          grupos: [entrada({ id: 'g-1' }), entrada({ id: 'g-2', itens: [{ id: 'i-1', nome: '  ', valor: 10 }] })],
        }),
      ),
    ).toEqual({ 'grupos.1.itens.0.nome': 'Dê um nome pro grupo' });
  });

  it('soma dos itens acima do valor do grupo → 400', async () => {
    expect(
      await detalhes(
        salvar.execute({
          subscriberId: 'sub-1',
          grupos: [
            entrada({
              valor: 100,
              itens: [
                { id: 'i-1', nome: 'Um', valor: 60 },
                { id: 'i-2', nome: 'Dois', valor: 60 },
              ],
            }),
          ],
        }),
      ),
    ).toEqual({ 'grupos.0.itens': 'A soma dos itens passou do valor do grupo' });
  });

  it(`para em ${MAX_ITENS_POR_GRUPO} itens por grupo`, async () => {
    const itens = Array.from({ length: MAX_ITENS_POR_GRUPO + 1 }, (_, i) => ({ id: `i-${i}`, nome: 'Item', valor: 1 }));
    expect(await detalhes(salvar.execute({ subscriberId: 'sub-1', grupos: [entrada({ itens })] }))).toEqual({
      'grupos.0.itens': `No máximo ${MAX_ITENS_POR_GRUPO} itens por grupo`,
    });
  });

  it('valida tudo ANTES de tocar no repositório: nada de meia árvore gravada', async () => {
    await salvar.execute({ subscriberId: 'sub-1', grupos: [entrada({ id: 'antigo', nome: 'Antigo' })] });

    await expect(
      salvar.execute({
        subscriberId: 'sub-1',
        grupos: [entrada({ id: 'g-1' }), entrada({ id: 'g-2', valor: 10.005 })],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect((await obter.execute({ subscriberId: 'sub-1' })).map((g) => g.nome)).toEqual(['Antigo']);
  });

  it('criadoEm vem do relógio, nunca de dentro do domínio', async () => {
    clock.set('2027-01-05T09:30:00.000Z');
    const [grupo] = await salvar.execute({ subscriberId: 'sub-1', grupos: [entrada()] });
    expect(grupo!.criadoEm).toEqual(new Date('2027-01-05T09:30:00.000Z'));
  });
});
