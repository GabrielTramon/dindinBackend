import { beforeEach, describe, expect, it } from 'vitest';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors';
import { FixedClock, SequentialIdGenerator } from '../../../shared/infra/in-memory/doubles';
import { Categoria } from '../../categorias';
import { InMemoryCategoriasRepository } from '../../categorias/infra';
import { GastoFixo, MAX_GASTOS_FIXOS } from '../domain/gasto-fixo';
import { InMemoryGastosFixosRepository } from '../infra/database/in-memory-gastos-fixos-repository';
import { AdicionarGastoFixoUseCase } from './adicionar-gasto-fixo.use-case';
import { AlterarGastoFixoUseCase } from './alterar-gasto-fixo.use-case';
import { ListarGastosFixosUseCase } from './listar-gastos-fixos.use-case';
import type { PerfilGateway } from './ports';
import { RemoverGastoFixoUseCase } from './remover-gasto-fixo.use-case';

/** quem tem perfil é quem o teste pôs no Set */
class PerfisDeTeste implements PerfilGateway {
  readonly comPerfil = new Set<string>(['sub-1', 'sub-2']);

  async exists(subscriberId: string): Promise<boolean> {
    return this.comPerfil.has(subscriberId);
  }
}

let gastos: InMemoryGastosFixosRepository;
let categorias: InMemoryCategoriasRepository;
let perfis: PerfisDeTeste;
let adicionar: AdicionarGastoFixoUseCase;
let alterar: AlterarGastoFixoUseCase;
let remover: RemoverGastoFixoUseCase;
let listar: ListarGastosFixosUseCase;

const MERCADO = InMemoryCategoriasRepository.catalogId('mercado');
const LUZ = InMemoryCategoriasRepository.catalogId('luz');
const ALUGUEL = InMemoryCategoriasRepository.catalogId('aluguel');
const agora = new Date('2026-09-17T12:00:00.000Z');

let sequenciaPersonalizada = 0;

/** cria e grava uma categoria personalizada */
async function criarPersonalizada(subscriberId: string, nome: string): Promise<Categoria> {
  const categoria = Categoria.criarPersonalizada({ id: `categoria-personalizada-${++sequenciaPersonalizada}`, nome, subscriberId, agora });
  await categorias.save(categoria);
  return categoria;
}

beforeEach(() => {
  perfis = new PerfisDeTeste();
  // a mesma ligação que o container faz: categoria com gasto está em uso
  categorias = new InMemoryCategoriasRepository({ withCatalog: true, isInUse: (id) => gastos.existsForCategory(id) });
  gastos = new InMemoryGastosFixosRepository({
    perfilExists: (id) => perfis.exists(id),
    categoriaExists: async (id) => (await categorias.findById(id)) !== null,
  });
  adicionar = new AdicionarGastoFixoUseCase(gastos, categorias, perfis, new SequentialIdGenerator('gasto'), new FixedClock());
  alterar = new AlterarGastoFixoUseCase(gastos, categorias);
  remover = new RemoverGastoFixoUseCase(gastos);
  listar = new ListarGastosFixosUseCase(gastos, categorias);
});

describe('AdicionarGastoFixoUseCase', () => {
  it('adiciona em categoria do catálogo, grava e devolve o gasto com a categoria', async () => {
    const { gasto, categoria } = await adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 450.9 });

    expect(gasto.toSnapshot()).toEqual({
      id: 'gasto-1',
      subscriberId: 'sub-1',
      categoriaId: MERCADO,
      valor: 450.9,
      criadoEm: agora,
    });
    expect(categoria).toMatchObject({ id: MERCADO, nome: 'Mercado' });
    expect((await gastos.findById('gasto-1', 'sub-1'))?.valor).toBe(450.9);
  });

  it('adiciona em categoria personalizada da própria pessoa', async () => {
    const clube = await criarPersonalizada('sub-1', 'Clube');
    const { categoria } = await adicionar.execute({ subscriberId: 'sub-1', categoriaId: clube.id, valor: 80 });
    expect(categoria.nome).toBe('Clube');
  });

  it('sem perfil → BusinessRuleError antes de qualquer outra checagem, e nada é gravado', async () => {
    await expect(
      adicionar.execute({ subscriberId: 'sem-perfil', categoriaId: 'nao-existe', valor: -1 }),
    ).rejects.toThrow(new BusinessRuleError('Crie seu perfil antes de adicionar gastos.'));
    expect(await gastos.countBySubscriber('sem-perfil')).toBe(0);
  });

  it('categoria inexistente → NotFound', async () => {
    await expect(adicionar.execute({ subscriberId: 'sub-1', categoriaId: 'nao-existe', valor: 10 })).rejects.toThrow(
      new NotFoundError('Categoria não encontrada.'),
    );
  });

  it('personalizada de OUTRA pessoa → NotFound, igual a inexistente, e nada é gravado', async () => {
    const deOutra = await criarPersonalizada('sub-2', 'Clube');
    await expect(adicionar.execute({ subscriberId: 'sub-1', categoriaId: deOutra.id, valor: 10 })).rejects.toThrow(
      new NotFoundError('Categoria não encontrada.'),
    );
    expect(await gastos.existsForCategory(deOutra.id)).toBe(false);
  });

  it('mesma categoria de novo → ConflictError com o nome da categoria, e o valor gravado não muda', async () => {
    await adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 450 });
    await expect(adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 600 })).rejects.toThrow(
      new ConflictError('Você já tem um gasto em Mercado. Altere o valor dele.', {
        categoriaId: 'Você já tem um gasto nessa categoria',
      }),
    );
    expect((await gastos.listBySubscriber('sub-1')).map((g) => g.valor)).toEqual([450]);
  });

  it('outra pessoa pode ter gasto na mesma categoria', async () => {
    await adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 450 });
    await expect(adicionar.execute({ subscriberId: 'sub-2', categoriaId: MERCADO, valor: 450 })).resolves.toBeDefined();
  });

  it(`para no limite de ${MAX_GASTOS_FIXOS} — e o limite vem antes da checagem de categoria repetida`, async () => {
    for (let i = 0; i < MAX_GASTOS_FIXOS; i++) {
      const categoria = await criarPersonalizada('sub-1', `Categoria ${i}`);
      await gastos.save(GastoFixo.criar({ id: `g${i}`, subscriberId: 'sub-1', categoriaId: categoria.id, valor: 10, agora }));
    }
    const noLimite = adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 10 });
    await expect(noLimite).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(noLimite).rejects.toThrow(`limite de ${MAX_GASTOS_FIXOS} gastos fixos`);

    await gastos.delete('g0', 'sub-1');
    await gastos.save(GastoFixo.criar({ id: 'g0', subscriberId: 'sub-1', categoriaId: MERCADO, valor: 10, agora }));
    await expect(adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 10 })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('valor inválido → ValidationError com a mensagem do onboarding, e nada é gravado', async () => {
    const acima = adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 1_000_000.01 });
    await expect(acima).rejects.toBeInstanceOf(ValidationError);
    await expect(acima).rejects.toMatchObject({ details: { valor: 'Confere esse valor? Está muito alto' } });
    await expect(adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 10.001 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await gastos.countBySubscriber('sub-1')).toBe(0);
  });
});

describe('AlterarGastoFixoUseCase', () => {
  it('altera só o valor, grava e devolve com a categoria', async () => {
    const { gasto } = await adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 450 });
    const alterado = await alterar.execute({ subscriberId: 'sub-1', gastoId: gasto.id, valor: 19.99 });

    expect(alterado.gasto.toSnapshot()).toEqual({ ...gasto.toSnapshot(), valor: 19.99 });
    expect(alterado.categoria.nome).toBe('Mercado');
    expect((await gastos.findById(gasto.id, 'sub-1'))?.valor).toBe(19.99);
  });

  it('de outra pessoa ou inexistente → NotFound, e o gravado não muda', async () => {
    const { gasto } = await adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 450 });
    await expect(alterar.execute({ subscriberId: 'sub-2', gastoId: gasto.id, valor: 1 })).rejects.toThrow(
      new NotFoundError('Gasto não encontrado.'),
    );
    await expect(alterar.execute({ subscriberId: 'sub-1', gastoId: 'nao-existe', valor: 1 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await gastos.findById(gasto.id, 'sub-1'))?.valor).toBe(450);
  });

  it('valor inválido → ValidationError e o gravado não muda', async () => {
    const { gasto } = await adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 450 });
    await expect(alterar.execute({ subscriberId: 'sub-1', gastoId: gasto.id, valor: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await gastos.findById(gasto.id, 'sub-1'))?.valor).toBe(450);
  });
});

describe('RemoverGastoFixoUseCase', () => {
  it('remove o próprio e a categoria deixa de estar em uso', async () => {
    const { gasto } = await adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 450 });
    expect(await categorias.isInUse(MERCADO)).toBe(true);

    await remover.execute({ subscriberId: 'sub-1', gastoId: gasto.id });
    expect(await gastos.findById(gasto.id, 'sub-1')).toBeNull();
    expect(await categorias.isInUse(MERCADO)).toBe(false);
  });

  it('de outra pessoa ou inexistente → NotFound, e o gasto continua lá', async () => {
    const { gasto } = await adicionar.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, valor: 450 });
    await expect(remover.execute({ subscriberId: 'sub-2', gastoId: gasto.id })).rejects.toThrow(
      new NotFoundError('Gasto não encontrado.'),
    );
    await expect(remover.execute({ subscriberId: 'sub-1', gastoId: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
    expect(await gastos.findById(gasto.id, 'sub-1')).not.toBeNull();
  });
});

describe('ListarGastosFixosUseCase', () => {
  it('lista na ordem do repositório, cada gasto com a sua categoria, só os da pessoa', async () => {
    const clube = await criarPersonalizada('sub-1', 'Clube');
    await adicionar.execute({ subscriberId: 'sub-1', categoriaId: LUZ, valor: 120 });
    await adicionar.execute({ subscriberId: 'sub-1', categoriaId: ALUGUEL, valor: 1500 });
    await adicionar.execute({ subscriberId: 'sub-1', categoriaId: clube.id, valor: 80 });
    await adicionar.execute({ subscriberId: 'sub-2', categoriaId: MERCADO, valor: 9000 });

    const itens = await listar.execute({ subscriberId: 'sub-1' });
    expect(itens.map(({ gasto, categoria }) => [gasto.valor, categoria.nome])).toEqual([
      [1500, 'Aluguel'],
      [120, 'Luz'],
      [80, 'Clube'],
    ]);
    expect(itens.every(({ gasto, categoria }) => gasto.categoriaId === categoria.id)).toBe(true);
  });

  it('sem gastos → lista vazia', async () => {
    expect(await listar.execute({ subscriberId: 'sub-1' })).toEqual([]);
  });
});
