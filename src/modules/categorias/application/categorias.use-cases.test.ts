import { beforeEach, describe, expect, it } from 'vitest';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors';
import { FixedClock, SequentialIdGenerator } from '../../../shared/infra/in-memory/doubles';
import { MAX_CATEGORIAS_PERSONALIZADAS } from '../domain/categoria';
import { InMemoryCategoriasRepository } from '../infra/database/in-memory-categorias-repository';
import { CriarCategoriaPersonalizadaUseCase } from './criar-categoria-personalizada.use-case';
import { ExcluirCategoriaUseCase } from './excluir-categoria.use-case';
import { ListarCategoriasUseCase } from './listar-categorias.use-case';
import { RenomearCategoriaUseCase } from './renomear-categoria.use-case';

let repo: InMemoryCategoriasRepository;
let emUso: Set<string>;
let criar: CriarCategoriaPersonalizadaUseCase;
let renomear: RenomearCategoriaUseCase;
let excluir: ExcluirCategoriaUseCase;
let listar: ListarCategoriasUseCase;

const MERCADO = InMemoryCategoriasRepository.catalogId('mercado');

beforeEach(() => {
  emUso = new Set();
  repo = new InMemoryCategoriasRepository({ withCatalog: true, isInUse: async (id) => emUso.has(id) });
  criar = new CriarCategoriaPersonalizadaUseCase(repo, new SequentialIdGenerator('cat'), new FixedClock());
  renomear = new RenomearCategoriaUseCase(repo);
  excluir = new ExcluirCategoriaUseCase(repo);
  listar = new ListarCategoriasUseCase(repo);
});

describe('CriarCategoriaPersonalizadaUseCase', () => {
  it('cria e grava', async () => {
    const c = await criar.execute({ subscriberId: 'sub-1', nome: ' Clube ' });
    expect(c).toMatchObject({ id: 'cat-1', nome: 'Clube', grupo: 'outros', subscriberId: 'sub-1' });
    expect((await repo.findById('cat-1'))?.nome).toBe('Clube');
  });

  it('recusa nome do catálogo, sem diferenciar maiúsculas', async () => {
    await expect(criar.execute({ subscriberId: 'sub-1', nome: 'mercado' })).rejects.toThrow(
      '"Mercado" já existe no catálogo',
    );
  });

  it('recusa nome repetido entre as próprias, sem diferenciar maiúsculas', async () => {
    await criar.execute({ subscriberId: 'sub-1', nome: 'Clube' });
    await expect(criar.execute({ subscriberId: 'sub-1', nome: 'CLUBE' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('outra pessoa pode usar o mesmo nome', async () => {
    await criar.execute({ subscriberId: 'sub-1', nome: 'Clube' });
    await expect(criar.execute({ subscriberId: 'sub-2', nome: 'Clube' })).resolves.toBeDefined();
  });

  it('valida o nome antes de consultar qualquer coisa', async () => {
    await expect(criar.execute({ subscriberId: 'sub-1', nome: '   ' })).rejects.toBeInstanceOf(ValidationError);
  });

  it(`para no limite de ${MAX_CATEGORIAS_PERSONALIZADAS}`, async () => {
    for (let i = 0; i < MAX_CATEGORIAS_PERSONALIZADAS; i++) {
      await criar.execute({ subscriberId: 'sub-1', nome: `Categoria ${i}` });
    }
    await expect(criar.execute({ subscriberId: 'sub-1', nome: 'Mais uma' })).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe('RenomearCategoriaUseCase', () => {
  it('renomeia a própria', async () => {
    const c = await criar.execute({ subscriberId: 'sub-1', nome: 'Clube' });
    const renomeada = await renomear.execute({ subscriberId: 'sub-1', categoriaId: c.id, nome: 'Clube do bairro' });
    expect(renomeada.nome).toBe('Clube do bairro');
    expect((await repo.findById(c.id))?.nome).toBe('Clube do bairro');
  });

  it('manter o mesmo nome (mudando só maiúsculas) não conflita consigo mesma', async () => {
    const c = await criar.execute({ subscriberId: 'sub-1', nome: 'clube' });
    await expect(renomear.execute({ subscriberId: 'sub-1', categoriaId: c.id, nome: 'Clube' })).resolves.toBeDefined();
  });

  it('de outra pessoa responde NotFound — não confirma que existe', async () => {
    const c = await criar.execute({ subscriberId: 'sub-1', nome: 'Clube' });
    await expect(renomear.execute({ subscriberId: 'sub-2', categoriaId: c.id, nome: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('catálogo → BusinessRuleError e nada muda', async () => {
    await expect(
      renomear.execute({ subscriberId: 'sub-1', categoriaId: MERCADO, nome: 'Supermercado' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect((await repo.findById(MERCADO))?.nome).toBe('Mercado');
  });

  it('nome já usado → ConflictError e o nome antigo continua gravado', async () => {
    await criar.execute({ subscriberId: 'sub-1', nome: 'Padaria' });
    const c = await criar.execute({ subscriberId: 'sub-1', nome: 'Clube' });
    await expect(renomear.execute({ subscriberId: 'sub-1', categoriaId: c.id, nome: 'padaria' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await repo.findById(c.id))?.nome).toBe('Clube');
  });
});

describe('ExcluirCategoriaUseCase', () => {
  it('exclui a própria sem gastos', async () => {
    const c = await criar.execute({ subscriberId: 'sub-1', nome: 'Clube' });
    await excluir.execute({ subscriberId: 'sub-1', categoriaId: c.id });
    expect(await repo.findById(c.id)).toBeNull();
  });

  it('em uso → ConflictError', async () => {
    const c = await criar.execute({ subscriberId: 'sub-1', nome: 'Clube' });
    emUso.add(c.id);
    await expect(excluir.execute({ subscriberId: 'sub-1', categoriaId: c.id })).rejects.toBeInstanceOf(ConflictError);
  });

  it('catálogo → BusinessRuleError; de outra pessoa ou inexistente → NotFound', async () => {
    const c = await criar.execute({ subscriberId: 'sub-1', nome: 'Clube' });
    await expect(excluir.execute({ subscriberId: 'sub-1', categoriaId: MERCADO })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    await expect(excluir.execute({ subscriberId: 'sub-2', categoriaId: c.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(excluir.execute({ subscriberId: 'sub-1', categoriaId: 'nao-existe' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('ListarCategoriasUseCase', () => {
  it('visitante vê só o catálogo; autenticado vê as próprias também', async () => {
    await criar.execute({ subscriberId: 'sub-1', nome: 'Clube' });
    const visitante = await listar.execute({ subscriberId: null });
    const autenticado = await listar.execute({ subscriberId: 'sub-1' });
    expect(autenticado).toHaveLength(visitante.length + 1);
  });
});
