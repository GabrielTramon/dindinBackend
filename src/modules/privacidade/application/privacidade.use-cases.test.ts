import { describe, expect, it } from 'vitest';
import type { TransactionManager } from '../../../shared/application/ports';
import { ValidationError } from '../../../shared/domain/errors';
import { FixedClock, InMemoryTransactionManager, SequentialIdGenerator } from '../../../shared/infra/in-memory/doubles';
import { gerarPlano } from '../../../shared/motor/motor';
import { InMemoryCategoriasRepository } from '../../categorias/infra';
import { CheckIn } from '../../check-ins';
import { InMemoryCheckInsRepository } from '../../check-ins/infra';
import { InMemoryDividasRepository } from '../../dividas/infra';
import { InMemoryGastosFixosRepository } from '../../gastos-fixos/infra';
import { InMemorySubscribersRepository } from '../../identidade/infra';
import { InMemoryMetasRepository } from '../../metas/infra';
import { InMemoryPerfisRepository } from '../../perfil/infra';
import { VersaoPlano } from '../../planos';
import { InMemoryVersoesPlanoRepository } from '../../planos/infra';
import { CONFIRMACAO_EXCLUSAO, ExcluirContaUseCase } from './excluir-conta.use-case';
import { ExportarDadosUseCase } from './exportar-dados.use-case';
import {
  ANA,
  BRUNO,
  CONTA_COMPLETA,
  criarContaCompleta,
  describePrivacidadeContract,
  ENTRADA_V1,
  retratoDa,
  type PrivacidadeHarness,
} from './privacidade.contract';

/*
  Casos de uso com os repositórios em memória DE VERDADE dos oito módulos,
  ligados como o container liga: categoria em uso = tem gasto (o Restrict de
  gastos_fixos.categoria_id); gasto e dívida exigem perfil; perfil e check-in
  exigem conta. Sem essas ligações, a ordem errada da exclusão passaria calada.
*/

function montar(
  transactions: TransactionManager = new InMemoryTransactionManager(),
  log?: string[],
): PrivacidadeHarness & { clock: FixedClock } {
  const clock = new FixedClock();
  const ids = new SequentialIdGenerator();
  const subscribers = new InMemorySubscribersRepository();
  const contaExiste = async (id: string) => (await subscribers.findById(id)) !== null;
  const perfis = new InMemoryPerfisRepository({ subscriberExists: contaExiste });
  const categorias = new InMemoryCategoriasRepository({
    withCatalog: true,
    isInUse: (id) => gastosFixos.existsForCategory(id),
  });
  const gastosFixos = new InMemoryGastosFixosRepository({
    perfilExists: (id) => perfis.exists(id),
    categoriaExists: async (id) => (await categorias.findById(id)) !== null,
  });
  const dividas = new InMemoryDividasRepository({ perfilExists: (id) => perfis.exists(id) });
  const versoesPlano = new InMemoryVersoesPlanoRepository();
  const metas = new InMemoryMetasRepository();
  const checkIns = new InMemoryCheckInsRepository({ subscriberExists: contaExiste });

  // os casos de uso recebem as versões que registram chamadas; as ligações acima usam as originais
  const usado = <T extends object>(nome: string, alvo: T): T => (log ? gravando(nome, alvo, log) : alvo);

  return {
    subscribers,
    perfis,
    categorias,
    gastosFixos,
    dividas,
    versoesPlano,
    metas,
    checkIns,
    ids,
    clock,
    exportar: new ExportarDadosUseCase(
      usado('subscribers', subscribers),
      usado('perfis', perfis),
      usado('gastosFixos', gastosFixos),
      usado('categorias', categorias),
      usado('dividas', dividas),
      usado('versoesPlano', versoesPlano),
      usado('metas', metas),
      usado('checkIns', checkIns),
      clock,
    ),
    excluir: new ExcluirContaUseCase(
      usado('subscribers', subscribers),
      usado('perfis', perfis),
      usado('gastosFixos', gastosFixos),
      usado('dividas', dividas),
      usado('categorias', categorias),
      usado('versoesPlano', versoesPlano),
      usado('metas', metas),
      usado('checkIns', checkIns),
      transactions,
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

describePrivacidadeContract('em memória', async () => montar());

describe('ExcluirContaUseCase — só em memória', () => {
  it('apaga dentro de UMA transação, na ordem das FKs, com o subscriber por último', async () => {
    const log: string[] = [];
    const m = montar(new TransacaoGravando(log), log);
    const ana = await criarContaCompleta(m, ANA);

    await m.excluir.execute({ subscriberId: ana.subscriberId, confirmacao: CONFIRMACAO_EXCLUSAO });

    expect(log).toEqual([
      'run:inicio',
      'gastosFixos.deleteAllBySubscriber',
      'dividas.deleteAllBySubscriber',
      'perfis.delete',
      'categorias.deleteAllCustom',
      'versoesPlano.deleteAllBySubscriber',
      'metas.deleteAllBySubscriber',
      'checkIns.deleteAllBySubscriber',
      'subscribers.delete',
      'run:fim',
    ]);
  });

  it('confirmação errada para antes de abrir a transação e de tocar em qualquer repositório', async () => {
    const log: string[] = [];
    const m = montar(new TransacaoGravando(log), log);
    const ana = await criarContaCompleta(m, ANA);

    await expect(m.excluir.execute({ subscriberId: ana.subscriberId, confirmacao: 'excluir' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(log).toEqual([]);
    expect(await retratoDa(m, ana.subscriberId)).toEqual(CONTA_COMPLETA);
  });
});

describe('ExportarDadosUseCase — só em memória', () => {
  it('traz todas as versões do plano e todos os check-ins, muito além de uma página', async () => {
    const m = montar();
    const ana = await criarContaCompleta(m, ANA);
    const bruno = await criarContaCompleta(m, BRUNO);

    // criarContaCompleta grava as versões 1 e 2; aqui vão até a 130
    const resultado = gerarPlano(ENTRADA_V1);
    for (let versao = 3; versao <= 130; versao++) {
      await m.versoesPlano.save(
        VersaoPlano.criar({
          id: m.ids.generate(),
          subscriberId: ana.subscriberId,
          versao,
          inputSnap: ENTRADA_V1,
          resultado,
          criadoEm: new Date(Date.UTC(2026, 8, 1, 0, versao)),
        }),
      );
    }

    // criarContaCompleta grava 2026-07 e 2026-08; aqui, todo o resto de 2020 a 2030
    const competencias: string[] = [];
    for (let ano = 2020; ano <= 2030; ano++) {
      for (let mes = 1; mes <= 12; mes++) competencias.push(`${ano}-${String(mes).padStart(2, '0')}`);
    }
    const noFuturo = new Date('2031-01-15T12:00:00.000Z');
    for (const competencia of competencias.filter((c) => c !== '2026-07' && c !== '2026-08')) {
      await m.checkIns.save(
        CheckIn.abrir({ id: m.ids.generate(), subscriberId: ana.subscriberId, competencia, agora: noFuturo }),
      );
    }

    const dados = await m.exportar.execute({ subscriberId: ana.subscriberId });
    expect(dados.planos.map((p) => p.versao)).toEqual(Array.from({ length: 130 }, (_, i) => 130 - i));
    expect(dados.checkIns.map((c) => c.competencia)).toEqual([...competencias].reverse());

    // e a outra pessoa continua só com o que é dela
    const deBruno = await m.exportar.execute({ subscriberId: bruno.subscriberId });
    expect(deBruno.planos.map((p) => p.versao)).toEqual([2, 1]);
    expect(deBruno.checkIns.map((c) => c.competencia)).toEqual(['2026-08', '2026-07']);
  });

  it('exportadoEm é a hora do relógio, não a do sistema', async () => {
    const m = montar();
    const ana = await criarContaCompleta(m, ANA);
    m.clock.set('2026-12-24T23:59:00.000Z');
    expect((await m.exportar.execute({ subscriberId: ana.subscriberId })).exportadoEm).toEqual(
      new Date('2026-12-24T23:59:00.000Z'),
    );
  });
});
