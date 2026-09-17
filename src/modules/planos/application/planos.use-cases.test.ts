import { beforeEach, describe, expect, it } from 'vitest';
import { encodeCursor } from '../../../shared/application/pagination';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors';
import { FixedClock, SequentialIdGenerator } from '../../../shared/infra/in-memory/doubles';
import { gerarPlano } from '../../../shared/motor/motor';
import { VersaoPlano, type PerfilDoMotor } from '../domain/versao-plano';
import { InMemoryVersoesPlanoRepository } from '../infra/database/in-memory-versoes-plano-repository';
import { GerarPlanoUseCase, TENTATIVAS_DE_GRAVAR_VERSAO } from './gerar-plano.use-case';
import { ListarVersoesPlanoUseCase } from './listar-versoes-plano.use-case';
import { ObterPlanoAtualUseCase } from './obter-plano-atual.use-case';
import { ObterVersaoPlanoUseCase } from './obter-versao-plano.use-case';
import type { PerfilDoMotorReader } from './ports';
import { SimularPlanoUseCase } from './simular-plano.use-case';

/** CLT de 24 anos, aluguel, cartão rodando e um gasto de nome livre. */
const ANA: PerfilDoMotor = {
  rendaMensal: 3200,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1100,
  gastosFixos: [
    { categoria: 'mercado', valor: 650 },
    { categoria: 'internet', valor: 99.9 },
    { categoria: 'transporte_publico', valor: 220 },
    { categoria: 'outro', nome: 'Clube do bairro', valor: 45 },
  ],
  dividas: [{ tipo: 'rotativo', saldo: 1800, parcela: 150 }],
  guardado: 400,
};

/** PJ de 29 anos, casa própria, sem dívida e com reserva andando. */
const BRUNO: PerfilDoMotor = {
  rendaMensal: 7500,
  tipoRenda: 'pj',
  idade: 29,
  moradia: 'propria',
  custoMoradia: 0,
  gastosFixos: [
    { categoria: 'mercado', valor: 1200 },
    { categoria: 'plano_saude', valor: 480.35 },
    { categoria: 'academia', valor: 119.9 },
    { categoria: 'streaming', valor: 55.8 },
  ],
  dividas: [],
  guardado: 12000,
};

/** O perfil salvo de cada pessoa, como o módulo perfil entregaria. */
class PerfisEmMemoria implements PerfilDoMotorReader {
  readonly perfis = new Map<string, PerfilDoMotor>();

  async load(subscriberId: string): Promise<PerfilDoMotor | null> {
    const perfil = this.perfis.get(subscriberId);
    return perfil ? structuredClone(perfil) : null;
  }
}

type OutraRequisicao = 'conflito' | 'erro de banco' | ((nossa: VersaoPlano) => VersaoPlano);

/**
 * Simula outra requisição agindo entre o nextVersion e o save desta: a cada
 * save, consome um item — lança ConflictError, lança um erro qualquer, ou grava
 * antes a versão que a "outra requisição" montou (e a nossa bate na unique).
 */
class VersoesComCorrida extends InMemoryVersoesPlanoRepository {
  saves = 0;

  constructor(private readonly outras: OutraRequisicao[]) {
    super();
  }

  override async save(versao: VersaoPlano): Promise<void> {
    this.saves++;
    const outra = this.outras.shift();
    if (outra === 'conflito') throw new ConflictError('Essa versão do plano já foi gravada.');
    if (outra === 'erro de banco') throw new Error('conexão perdida');
    if (outra) await super.save(outra(versao));
    return super.save(versao);
  }
}

const agora = new Date('2026-09-17T12:00:00.000Z');

let repo: InMemoryVersoesPlanoRepository;
let perfis: PerfisEmMemoria;
let clock: FixedClock;
let gerar: GerarPlanoUseCase;
let obterAtual: ObterPlanoAtualUseCase;
let obterVersao: ObterVersaoPlanoUseCase;
let listar: ListarVersoesPlanoUseCase;

const gerarCom = (versoes: InMemoryVersoesPlanoRepository) =>
  new GerarPlanoUseCase(versoes, perfis, new SequentialIdGenerator('plano'), clock);

beforeEach(() => {
  repo = new InMemoryVersoesPlanoRepository();
  perfis = new PerfisEmMemoria();
  clock = new FixedClock(agora);
  gerar = gerarCom(repo);
  obterAtual = new ObterPlanoAtualUseCase(repo);
  obterVersao = new ObterVersaoPlanoUseCase(repo);
  listar = new ListarVersoesPlanoUseCase(repo);
  perfis.perfis.set('sub-1', structuredClone(ANA));
  perfis.perfis.set('sub-2', structuredClone(BRUNO));
});

/** a versão que outra requisição gravaria com este perfil, no mesmo número da nossa */
const versaoConcorrente = (perfil: PerfilDoMotor) => (nossa: VersaoPlano) =>
  VersaoPlano.criar({
    id: `outra-${nossa.versao}`,
    subscriberId: nossa.subscriberId,
    versao: nossa.versao,
    inputSnap: perfil,
    resultado: gerarPlano(structuredClone(perfil)),
    criadoEm: agora,
  });

describe('GerarPlanoUseCase', () => {
  it('sem perfil → BusinessRuleError e nada é gravado', async () => {
    await expect(gerar.execute({ subscriberId: 'sem-perfil' })).rejects.toThrow(
      new BusinessRuleError('Responda o seu perfil antes de gerar o plano.'),
    );
    expect(await repo.findLatest('sem-perfil')).toBeNull();
  });

  it('primeira vez: grava a versão 1 com o perfil salvo e o resultado do motor', async () => {
    const { versao, criada } = await gerar.execute({ subscriberId: 'sub-1' });

    expect(criada).toBe(true);
    expect(versao).toMatchObject({ id: 'plano-1', subscriberId: 'sub-1', versao: 1 });
    expect(versao.criadoEm).toEqual(agora);
    expect(versao.inputSnap).toEqual(ANA);
    expect(versao.resultado).toEqual(gerarPlano(structuredClone(ANA)));
    expect((await repo.findLatest('sub-1'))?.id).toBe('plano-1');
  });

  it('recalcular sem mudar o perfil devolve a mesma versão e não grava outra', async () => {
    await gerar.execute({ subscriberId: 'sub-1' });
    clock.advance(60_000);

    const { versao, criada } = await gerar.execute({ subscriberId: 'sub-1' });
    expect(criada).toBe(false);
    expect(versao.versao).toBe(1);
    expect(versao.criadoEm).toEqual(agora);
    expect(await repo.nextVersion('sub-1')).toBe(2);
  });

  it('perfil mudou → versão 2; voltar ao perfil antigo → versão 3 (compara só com a última)', async () => {
    await gerar.execute({ subscriberId: 'sub-1' });

    perfis.perfis.set('sub-1', { ...structuredClone(ANA), guardado: 900 });
    const segunda = await gerar.execute({ subscriberId: 'sub-1' });
    expect(segunda).toMatchObject({ criada: true });
    expect(segunda.versao.versao).toBe(2);
    expect(segunda.versao.inputSnap.guardado).toBe(900);

    perfis.perfis.set('sub-1', structuredClone(ANA));
    expect((await gerar.execute({ subscriberId: 'sub-1' })).versao.versao).toBe(3);
  });

  it('ordem das chaves e chave opcional undefined não contam como mudança', async () => {
    await gerar.execute({ subscriberId: 'sub-1' });

    const { gastosFixos, dividas, ...resto } = structuredClone(ANA);
    const mesmaCoisa = {
      dividas: dividas.map((d) => ({ ...d, taxaAnual: undefined })),
      gastosFixos,
      ...resto,
    };
    perfis.perfis.set('sub-1', mesmaCoisa);

    expect(await gerar.execute({ subscriberId: 'sub-1' })).toMatchObject({ criada: false });
  });

  it('mudar a ordem dos gastos conta como mudança: a lista é o que o motor recebeu', async () => {
    await gerar.execute({ subscriberId: 'sub-1' });
    perfis.perfis.set('sub-1', { ...structuredClone(ANA), gastosFixos: [...structuredClone(ANA).gastosFixos].reverse() });
    expect(await gerar.execute({ subscriberId: 'sub-1' })).toMatchObject({ criada: true });
  });

  it('mesmo perfil, mas o motor mudou (resultado gravado diferente) → versão nova', async () => {
    const antigo = gerarPlano(structuredClone(ANA));
    await repo.save(
      VersaoPlano.criar({
        id: 'motor-antigo',
        subscriberId: 'sub-1',
        versao: 1,
        inputSnap: ANA,
        resultado: { ...antigo, aporte: antigo.aporte + 1 },
        criadoEm: agora,
      }),
    );

    const { versao, criada } = await gerar.execute({ subscriberId: 'sub-1' });
    expect(criada).toBe(true);
    expect(versao.versao).toBe(2);
  });

  it('versões de pessoas diferentes são independentes', async () => {
    await gerar.execute({ subscriberId: 'sub-1' });
    perfis.perfis.set('sub-1', { ...structuredClone(ANA), idade: 25 });
    await gerar.execute({ subscriberId: 'sub-1' });

    const deOutra = await gerar.execute({ subscriberId: 'sub-2' });
    expect(deOutra.versao).toMatchObject({ versao: 1, subscriberId: 'sub-2' });
    expect(deOutra.versao.inputSnap).toEqual(BRUNO);
  });

  it('corrida: o primeiro save bate na unique → sucesso na segunda tentativa', async () => {
    const versoes = new VersoesComCorrida(['conflito']);
    const { versao, criada } = await gerarCom(versoes).execute({ subscriberId: 'sub-1' });

    expect(criada).toBe(true);
    expect(versao.versao).toBe(1);
    expect(versoes.saves).toBe(2);
    expect((await versoes.findLatest('sub-1'))?.id).toBe(versao.id);
  });

  it('corrida com a mesma entrada: a outra requisição gravou primeiro → devolve a dela, sem duplicar', async () => {
    const versoes = new VersoesComCorrida([versaoConcorrente(ANA)]);
    const { versao, criada } = await gerarCom(versoes).execute({ subscriberId: 'sub-1' });

    expect(criada).toBe(false);
    expect(versao.id).toBe('outra-1');
    expect(versoes.saves).toBe(1);
    expect(await versoes.nextVersion('sub-1')).toBe(2);
  });

  it('corrida com outra entrada (outro aparelho mudou o perfil) → a nossa vira a versão seguinte', async () => {
    const versoes = new VersoesComCorrida([versaoConcorrente(BRUNO)]);
    const { versao, criada } = await gerarCom(versoes).execute({ subscriberId: 'sub-1' });

    expect(criada).toBe(true);
    expect(versao.versao).toBe(2);
    expect(versao.inputSnap).toEqual(ANA);
    expect((await versoes.findByVersion('sub-1', 1))?.id).toBe('outra-1');
  });

  it(`conflito nas ${TENTATIVAS_DE_GRAVAR_VERSAO} tentativas → ConflictError pra tentar de novo, nada gravado`, async () => {
    const versoes = new VersoesComCorrida(
      Array.from({ length: TENTATIVAS_DE_GRAVAR_VERSAO }, (): OutraRequisicao => 'conflito'),
    );
    await expect(gerarCom(versoes).execute({ subscriberId: 'sub-1' })).rejects.toThrow(
      new ConflictError('Outro cálculo do plano estava em andamento. Tente de novo.'),
    );
    expect(versoes.saves).toBe(TENTATIVAS_DE_GRAVAR_VERSAO);
    expect(await versoes.findLatest('sub-1')).toBeNull();
  });

  it('erro que não é conflito sobe na hora, sem nova tentativa', async () => {
    const versoes = new VersoesComCorrida(['erro de banco']);
    await expect(gerarCom(versoes).execute({ subscriberId: 'sub-1' })).rejects.toThrow('conexão perdida');
    expect(versoes.saves).toBe(1);
  });
});

describe('ObterPlanoAtualUseCase', () => {
  it('sem plano → NotFound com a mensagem da tela', async () => {
    await expect(obterAtual.execute({ subscriberId: 'sub-1' })).rejects.toThrow(
      new NotFoundError('Você ainda não gerou um plano.'),
    );
  });

  it('devolve a versão mais nova, nunca a de outra pessoa', async () => {
    await gerar.execute({ subscriberId: 'sub-1' });
    perfis.perfis.set('sub-1', { ...structuredClone(ANA), rendaMensal: 3500 });
    await gerar.execute({ subscriberId: 'sub-1' });

    expect((await obterAtual.execute({ subscriberId: 'sub-1' })).versao).toBe(2);
    await expect(obterAtual.execute({ subscriberId: 'sub-2' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ObterVersaoPlanoUseCase', () => {
  it('acha a versão da pessoa; de outra pessoa ou inexistente → NotFound', async () => {
    await gerar.execute({ subscriberId: 'sub-1' });

    expect((await obterVersao.execute({ subscriberId: 'sub-1', versao: 1 })).inputSnap).toEqual(ANA);
    await expect(obterVersao.execute({ subscriberId: 'sub-2', versao: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(obterVersao.execute({ subscriberId: 'sub-1', versao: 2 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ListarVersoesPlanoUseCase', () => {
  it('pagina da mais nova pra mais antiga com cursor', async () => {
    for (const guardado of [100, 200, 300]) {
      perfis.perfis.set('sub-1', { ...structuredClone(ANA), guardado });
      await gerar.execute({ subscriberId: 'sub-1' });
    }

    const p1 = await listar.execute({ subscriberId: 'sub-1', limit: 2 });
    expect(p1.items.map((v) => v.versao)).toEqual([3, 2]);
    const p2 = await listar.execute({ subscriberId: 'sub-1', limit: 2, cursor: p1.nextCursor });
    expect(p2.items.map((v) => v.versao)).toEqual([1]);
    expect(p2.nextCursor).toBeNull();

    expect(await listar.execute({ subscriberId: 'sub-2', limit: 20 })).toEqual({ items: [], nextCursor: null });
  });

  it('cursor ilegível → ValidationError', async () => {
    await expect(listar.execute({ subscriberId: 'sub-1', limit: 20, cursor: encodeCursor('abc') })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('SimularPlanoUseCase', () => {
  it('devolve o plano do motor sem gravar nada e sem mexer na entrada', async () => {
    const entrada = structuredClone(BRUNO);
    const plano = await new SimularPlanoUseCase().execute({ perfil: entrada });

    expect(plano).toEqual(gerarPlano(structuredClone(BRUNO)));
    plano.perfil.rendaMensal = 1;
    expect(entrada).toEqual(BRUNO);
    expect(await repo.findLatest('sub-2')).toBeNull();
  });
});
