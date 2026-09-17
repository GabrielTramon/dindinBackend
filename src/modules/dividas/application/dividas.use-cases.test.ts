import { beforeEach, describe, expect, it } from 'vitest';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../shared/domain/errors';
import { FixedClock, SequentialIdGenerator } from '../../../shared/infra/in-memory/doubles';
import { MAX_DIVIDAS } from '../domain/divida';
import { InMemoryDividasRepository } from '../infra/database/in-memory-dividas-repository';
import { AdicionarDividaUseCase } from './adicionar-divida.use-case';
import { AlterarDividaUseCase } from './alterar-divida.use-case';
import { ListarDividasUseCase } from './listar-dividas.use-case';
import { RemoverDividaUseCase } from './remover-divida.use-case';

let repo: InMemoryDividasRepository;
let perfis: Set<string>;
let clock: FixedClock;
let adicionar: AdicionarDividaUseCase;
let alterar: AlterarDividaUseCase;
let remover: RemoverDividaUseCase;
let listar: ListarDividasUseCase;

beforeEach(() => {
  perfis = new Set(['sub-1', 'sub-2']);
  const perfilExists = async (id: string) => perfis.has(id);
  repo = new InMemoryDividasRepository({ perfilExists });
  clock = new FixedClock();
  adicionar = new AdicionarDividaUseCase(repo, { exists: perfilExists }, new SequentialIdGenerator('div'), clock);
  alterar = new AlterarDividaUseCase(repo);
  remover = new RemoverDividaUseCase(repo);
  listar = new ListarDividasUseCase(repo);
});

describe('AdicionarDividaUseCase', () => {
  it('cria com os dados informados, o dono e a hora do relógio, e grava', async () => {
    const d = await adicionar.execute({
      subscriberId: 'sub-1',
      tipo: 'emprestimo',
      saldo: 1500.1,
      parcela: 99.9,
      taxaAnual: 0.8765,
    });
    expect(d.toSnapshot()).toEqual({
      id: 'div-1',
      subscriberId: 'sub-1',
      tipo: 'emprestimo',
      saldo: 1500.1,
      parcela: 99.9,
      taxaAnual: 0.8765,
      criadoEm: clock.now(),
    });
    expect((await repo.findById('div-1', 'sub-1'))?.toSnapshot()).toEqual(d.toSnapshot());
  });

  it('parcela e taxa ausentes (ou null) viram null', async () => {
    const ausentes = await adicionar.execute({ subscriberId: 'sub-1', tipo: 'rotativo', saldo: 800 });
    const nulos = await adicionar.execute({
      subscriberId: 'sub-1',
      tipo: 'rotativo',
      saldo: 800,
      parcela: null,
      taxaAnual: null,
    });
    for (const d of [ausentes, nulos]) {
      expect(d.parcela).toBeNull();
      expect(d.taxaAnual).toBeNull();
    }
  });

  it('sem perfil → BusinessRuleError com a orientação, e nada é gravado', async () => {
    await expect(adicionar.execute({ subscriberId: 'sem-perfil', tipo: 'outra', saldo: 100 })).rejects.toThrow(
      new BusinessRuleError('Crie seu perfil antes de adicionar dívidas.'),
    );
    expect(await repo.countBySubscriber('sem-perfil')).toBe(0);
  });

  it('valida os campos antes de consultar o perfil: campo errado é 400 mesmo sem perfil', async () => {
    await expect(
      adicionar.execute({ subscriberId: 'sem-perfil', tipo: 'outra', saldo: 100, taxaAnual: 0.12345 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it(`para no limite de ${MAX_DIVIDAS}, contando só as da própria pessoa`, async () => {
    for (let i = 0; i < MAX_DIVIDAS; i++) {
      await adicionar.execute({ subscriberId: 'sub-1', tipo: 'outra', saldo: 100 + i });
    }
    await expect(adicionar.execute({ subscriberId: 'sub-1', tipo: 'outra', saldo: 1 })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(await repo.countBySubscriber('sub-1')).toBe(MAX_DIVIDAS);
    await expect(adicionar.execute({ subscriberId: 'sub-2', tipo: 'outra', saldo: 1 })).resolves.toBeDefined();
  });

  it('depois de remover uma, abre vaga de novo', async () => {
    for (let i = 0; i < MAX_DIVIDAS; i++) {
      await adicionar.execute({ subscriberId: 'sub-1', tipo: 'outra', saldo: 100 });
    }
    await remover.execute({ subscriberId: 'sub-1', dividaId: 'div-1' });
    await expect(adicionar.execute({ subscriberId: 'sub-1', tipo: 'outra', saldo: 1 })).resolves.toBeDefined();
  });
});

describe('AlterarDividaUseCase', () => {
  const criar = () =>
    adicionar.execute({ subscriberId: 'sub-1', tipo: 'emprestimo', saldo: 1000, parcela: 120, taxaAnual: 0.9 });

  it('campo ausente não mexe; o que veio muda e é gravado', async () => {
    const d = await criar();
    const alterada = await alterar.execute({ subscriberId: 'sub-1', dividaId: d.id, saldo: 850.25 });
    expect(alterada.toSnapshot()).toMatchObject({ tipo: 'emprestimo', saldo: 850.25, parcela: 120, taxaAnual: 0.9 });
    expect((await repo.findById(d.id, 'sub-1'))?.saldo).toBe(850.25);
  });

  it('null limpa parcela e taxa', async () => {
    const d = await criar();
    await alterar.execute({ subscriberId: 'sub-1', dividaId: d.id, parcela: null, taxaAnual: null });
    const gravada = await repo.findById(d.id, 'sub-1');
    expect(gravada?.parcela).toBeNull();
    expect(gravada?.taxaAnual).toBeNull();
  });

  it('de outra pessoa ou inexistente → NotFound, e nada muda', async () => {
    const d = await criar();
    await expect(alterar.execute({ subscriberId: 'sub-2', dividaId: d.id, saldo: 1 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(alterar.execute({ subscriberId: 'sub-1', dividaId: 'nao-existe', saldo: 1 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await repo.findById(d.id, 'sub-1'))?.saldo).toBe(1000);
  });

  it('valor inválido → ValidationError e o gravado continua igual', async () => {
    const d = await criar();
    await expect(
      alterar.execute({ subscriberId: 'sub-1', dividaId: d.id, saldo: 500, parcela: 10.001 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await repo.findById(d.id, 'sub-1'))?.toSnapshot()).toEqual(d.toSnapshot());
  });

  it('o dono vem do chamador: chaves extras na entrada não trocam o dono nem o id', async () => {
    const d = await criar();
    const entrada = { subscriberId: 'sub-1', dividaId: d.id, saldo: 900, id: 'x', criadoEm: new Date(0) };
    const alterada = await alterar.execute(entrada);
    expect(alterada.toSnapshot()).toMatchObject({ id: d.id, subscriberId: 'sub-1', criadoEm: d.criadoEm, saldo: 900 });
  });
});

describe('RemoverDividaUseCase', () => {
  it('remove a própria', async () => {
    const d = await adicionar.execute({ subscriberId: 'sub-1', tipo: 'outra', saldo: 100 });
    await remover.execute({ subscriberId: 'sub-1', dividaId: d.id });
    expect(await repo.findById(d.id, 'sub-1')).toBeNull();
  });

  it('de outra pessoa ou inexistente → NotFound, e a dívida continua lá', async () => {
    const d = await adicionar.execute({ subscriberId: 'sub-1', tipo: 'outra', saldo: 100 });
    await expect(remover.execute({ subscriberId: 'sub-2', dividaId: d.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(remover.execute({ subscriberId: 'sub-1', dividaId: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
    expect(await repo.findById(d.id, 'sub-1')).not.toBeNull();
  });
});

describe('ListarDividasUseCase', () => {
  it('só as da pessoa, na ordem em que foram adicionadas', async () => {
    const primeira = await adicionar.execute({ subscriberId: 'sub-1', tipo: 'financiamento', saldo: 20000 });
    clock.advance(1_000);
    await adicionar.execute({ subscriberId: 'sub-2', tipo: 'rotativo', saldo: 50 });
    clock.advance(1_000);
    const segunda = await adicionar.execute({ subscriberId: 'sub-1', tipo: 'rotativo', saldo: 300 });

    expect((await listar.execute({ subscriberId: 'sub-1' })).map((d) => d.id)).toEqual([primeira.id, segunda.id]);
  });
});
