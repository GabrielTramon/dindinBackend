import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionManager } from '../../../shared/application/ports';
import { NotFoundError, ValidationError } from '../../../shared/domain/errors';
import { FixedClock, InMemoryTransactionManager, SequentialIdGenerator } from '../../../shared/infra/in-memory/doubles';
import { InMemoryCategoriasRepository } from '../../categorias/infra';
import { InMemoryDividasRepository } from '../../dividas/infra';
import { InMemoryGastosFixosRepository } from '../../gastos-fixos/infra';
import type { DadosPerfil } from '../domain/perfil';
import { InMemoryPerfisRepository } from '../infra/database/in-memory-perfis-repository';
import { AtualizarPerfilUseCase } from './atualizar-perfil.use-case';
import { ObterPerfilCompletoUseCase } from './obter-perfil-completo.use-case';
import { ObterPerfilUseCase } from './obter-perfil.use-case';
import { CarregarPerfilDoMotorUseCase, type PerfilDoMotor } from './perfil-do-motor';
import { SalvarPerfilUseCase } from './salvar-perfil.use-case';
import { describeSincronizarPerfilCompletoContract } from './sincronizar-perfil-completo.contract';
import { SincronizarPerfilCompletoUseCase } from './sincronizar-perfil-completo.use-case';

/*
  Casos de uso com os repositórios em memória de verdade dos quatro módulos,
  ligados como o container liga: categoria em uso = tem gasto; gasto e dívida
  exigem perfil; gasto exige categoria existente.
*/

function montar(transactions: TransactionManager = new InMemoryTransactionManager(), log?: string[]) {
  const clock = new FixedClock();
  const ids = new SequentialIdGenerator();
  const perfis = new InMemoryPerfisRepository();
  const categorias = new InMemoryCategoriasRepository({
    withCatalog: true,
    isInUse: (id) => gastosFixos.existsForCategory(id),
  });
  const gastosFixos = new InMemoryGastosFixosRepository({
    perfilExists: (id) => perfis.exists(id),
    categoriaExists: async (id) => (await categorias.findById(id)) !== null,
  });
  const dividas = new InMemoryDividasRepository({ perfilExists: (id) => perfis.exists(id) });

  // os casos de uso recebem as versões que registram chamadas; as ligações acima usam as originais
  const usados = {
    perfis: log ? gravando('perfis', perfis, log) : perfis,
    categorias: log ? gravando('categorias', categorias, log) : categorias,
    gastosFixos: log ? gravando('gastosFixos', gastosFixos, log) : gastosFixos,
    dividas: log ? gravando('dividas', dividas, log) : dividas,
  };
  const carregar = new CarregarPerfilDoMotorUseCase(usados.perfis, usados.gastosFixos, usados.categorias, usados.dividas);
  return {
    clock,
    perfis,
    categorias,
    gastosFixos,
    dividas,
    obter: new ObterPerfilUseCase(perfis),
    salvar: new SalvarPerfilUseCase(perfis, clock),
    atualizar: new AtualizarPerfilUseCase(perfis, clock),
    obterCompleto: new ObterPerfilCompletoUseCase(carregar),
    sincronizar: new SincronizarPerfilCompletoUseCase(
      usados.perfis,
      usados.categorias,
      usados.gastosFixos,
      usados.dividas,
      transactions,
      ids,
      clock,
      carregar,
    ),
  };
}

/** Registra "nome.metodo" a cada chamada vinda de fora do repositório. */
function gravando<T extends object>(nome: string, alvo: T, log: string[]): T {
  return new Proxy(alvo, {
    get(target, prop, receiver) {
      const valor: unknown = Reflect.get(target, prop, receiver);
      if (typeof valor !== 'function') return valor;
      return (...args: unknown[]) => {
        log.push(`${nome}.${String(prop)}`);
        return Reflect.apply(valor, target, args);
      };
    },
  });
}

class TransacaoGravando implements TransactionManager {
  constructor(private readonly log: string[]) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.log.push('run:inicio');
    const resultado = await work();
    this.log.push('run:fim');
    return resultado;
  }
}

const DADOS: DadosPerfil = {
  rendaMensal: 2800.5,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1200,
  guardado: 1000,
};

const COMPLETO: PerfilDoMotor = { ...DADOS, gastosFixos: [], dividas: [] };

let m: ReturnType<typeof montar>;

beforeEach(() => {
  m = montar();
});

describe('ObterPerfilUseCase', () => {
  it('devolve o perfil da própria pessoa', async () => {
    await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS });
    expect((await m.obter.execute({ subscriberId: 'sub-1' })).toDados()).toEqual(DADOS);
  });

  it('sem perfil → NotFound com a orientação; o perfil de outra pessoa não conta', async () => {
    await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS });
    await expect(m.obter.execute({ subscriberId: 'sub-2' })).rejects.toThrow(
      new NotFoundError('Você ainda não respondeu o perfil.'),
    );
  });
});

describe('SalvarPerfilUseCase', () => {
  it('sem perfil: cria, grava e avisa que criou', async () => {
    const { perfil, criado } = await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS });
    expect(criado).toBe(true);
    expect(perfil.toSnapshot()).toEqual({ ...DADOS, subscriberId: 'sub-1', atualizadoEm: m.clock.now() });
    expect((await m.perfis.findBySubscriberId('sub-1'))?.toSnapshot()).toEqual(perfil.toSnapshot());
  });

  it('com perfil: substitui todas as respostas, renova a data e avisa que atualizou', async () => {
    await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS });
    m.clock.advance(60_000);
    const novos: DadosPerfil = { rendaMensal: 5000, tipoRenda: 'pj', idade: 30, moradia: 'pais', custoMoradia: 900, guardado: 0 };

    const { perfil, criado } = await m.salvar.execute({ subscriberId: 'sub-1', ...novos });
    expect(criado).toBe(false);
    // moradia sem custo zera o custo, como no onboarding
    expect(perfil.toSnapshot()).toEqual({ ...novos, custoMoradia: 0, subscriberId: 'sub-1', atualizadoEm: m.clock.now() });
    expect((await m.perfis.findBySubscriberId('sub-1'))?.toSnapshot()).toEqual(perfil.toSnapshot());
  });

  it('dado inválido → ValidationError no campo, e nada muda', async () => {
    await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS });
    const antes = (await m.perfis.findBySubscriberId('sub-1'))?.toSnapshot();

    await expect(m.salvar.execute({ subscriberId: 'sub-1', ...DADOS, rendaMensal: 10.005 })).rejects.toMatchObject({
      details: { rendaMensal: 'No máximo 2 casas decimais' },
    });
    await expect(m.salvar.execute({ subscriberId: 'sub-2', ...DADOS, idade: 13 })).rejects.toBeInstanceOf(ValidationError);
    expect((await m.perfis.findBySubscriberId('sub-1'))?.toSnapshot()).toEqual(antes);
    expect(await m.perfis.exists('sub-2')).toBe(false);
  });
});

describe('AtualizarPerfilUseCase', () => {
  it('muda só o que veio, grava e renova a data', async () => {
    await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS });
    m.clock.advance(1_000);

    const perfil = await m.atualizar.execute({ subscriberId: 'sub-1', guardado: 1500.75, idade: 25 });
    expect(perfil.toSnapshot()).toEqual({ ...DADOS, guardado: 1500.75, idade: 25, subscriberId: 'sub-1', atualizadoEm: m.clock.now() });
    expect((await m.perfis.findBySubscriberId('sub-1'))?.toSnapshot()).toEqual(perfil.toSnapshot());
  });

  it('sem perfil (ou só com o perfil de outra pessoa) → NotFound', async () => {
    await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS });
    await expect(m.atualizar.execute({ subscriberId: 'sub-2', idade: 30 })).rejects.toThrow(
      new NotFoundError('Você ainda não respondeu o perfil.'),
    );
    expect((await m.perfis.findBySubscriberId('sub-1'))?.idade).toBe(24);
  });

  it('sair de moradia sem custo pra com custo sem informar o custo → ValidationError e nada muda', async () => {
    await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS, moradia: 'pais', custoMoradia: 0 });
    const antes = (await m.perfis.findBySubscriberId('sub-1'))?.toSnapshot();

    await expect(m.atualizar.execute({ subscriberId: 'sub-1', moradia: 'aluguel' })).rejects.toMatchObject({
      details: { custoMoradia: 'Informe quanto sai de moradia' },
    });
    expect((await m.perfis.findBySubscriberId('sub-1'))?.toSnapshot()).toEqual(antes);

    const perfil = await m.atualizar.execute({ subscriberId: 'sub-1', moradia: 'aluguel', custoMoradia: 1300 });
    expect(perfil.toDados()).toMatchObject({ moradia: 'aluguel', custoMoradia: 1300 });
  });

  it('valor inválido → ValidationError e o gravado não muda', async () => {
    await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS });
    await expect(m.atualizar.execute({ subscriberId: 'sub-1', guardado: -1 })).rejects.toBeInstanceOf(ValidationError);
    expect((await m.perfis.findBySubscriberId('sub-1'))?.guardado).toBe(1000);
  });
});

describe('ObterPerfilCompletoUseCase', () => {
  it('sem perfil → NotFound', async () => {
    await expect(m.obterCompleto.execute({ subscriberId: 'sub-1' })).rejects.toThrow(
      new NotFoundError('Você ainda não respondeu o perfil.'),
    );
  });

  it('perfil salvo só com as respostas escalares vem com listas vazias', async () => {
    await m.salvar.execute({ subscriberId: 'sub-1', ...DADOS });
    expect(await m.obterCompleto.execute({ subscriberId: 'sub-1' })).toEqual(COMPLETO);
  });
});

describe('SincronizarPerfilCompletoUseCase — só em memória', () => {
  it('grava o perfil primeiro e faz tudo dentro de UMA transação, na ordem combinada; o recarregado vem depois', async () => {
    const log: string[] = [];
    const g = montar(new TransacaoGravando(log), log);
    await g.sincronizar.execute({
      subscriberId: 'sub-1',
      perfil: { ...COMPLETO, gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 80 }] },
    });
    log.length = 0;

    await g.sincronizar.execute({
      subscriberId: 'sub-1',
      perfil: {
        ...COMPLETO,
        gastosFixos: [{ categoria: 'outro', nome: 'Clube de tiro', valor: 80 }],
        dividas: [{ tipo: 'rotativo', saldo: 500 }],
      },
    });

    const fim = log.indexOf('run:fim');
    expect(log.slice(0, fim + 1)).toEqual([
      'run:inicio',
      'perfis.findBySubscriberId',
      'perfis.save',
      'categorias.listVisible',
      'gastosFixos.listBySubscriber',
      'categorias.save',
      'gastosFixos.replaceAll',
      'dividas.replaceAll',
      'categorias.delete',
      'run:fim',
    ]);
    // depois da transação, só leitura (o recarregado)
    expect(log.slice(fim + 1).every((chamada) => /\.(find|list)/.test(chamada))).toBe(true);
    expect(log.slice(fim + 1)).toContain('perfis.findBySubscriberId');
  });

  it('soma de linhas acima do teto → ValidationError na primeira linha do grupo, antes de criar qualquer categoria', async () => {
    const falha = m.sincronizar.execute({
      subscriberId: 'sub-1',
      perfil: {
        ...COMPLETO,
        gastosFixos: [
          { categoria: 'luz', valor: 10 },
          { categoria: 'outro', nome: 'Clube', valor: 600_000 },
          { categoria: 'outro', nome: 'clube', valor: 600_000 },
        ],
      },
    });

    await expect(falha).rejects.toBeInstanceOf(ValidationError);
    await expect(falha).rejects.toMatchObject({ details: { 'gastosFixos.1.valor': 'Confere esse valor? Está muito alto' } });
    expect(await m.categorias.countCustom('sub-1')).toBe(0);
    expect(await m.gastosFixos.countBySubscriber('sub-1')).toBe(0);
  });

  it('o dono é o subscriberId recebido: chave extra no perfil não troca o dono', async () => {
    await m.sincronizar.execute({
      subscriberId: 'sub-1',
      perfil: { ...COMPLETO, subscriberId: 'sub-2', dividas: [{ tipo: 'outra', saldo: 10 }] } as PerfilDoMotor,
    });
    expect(await m.perfis.exists('sub-1')).toBe(true);
    expect(await m.perfis.exists('sub-2')).toBe(false);
    expect(await m.dividas.countBySubscriber('sub-1')).toBe(1);
  });
});

describeSincronizarPerfilCompletoContract('em memória', async () => {
  const montado = montar();
  let subscribers = 0;
  return {
    sincronizar: montado.sincronizar,
    obterCompleto: montado.obterCompleto,
    perfis: montado.perfis,
    categorias: montado.categorias,
    gastosFixos: montado.gastosFixos,
    dividas: montado.dividas,
    clock: montado.clock,
    criarSubscriber: async () => `sub-${++subscribers}`,
  };
});
