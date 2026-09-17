import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PAGE_LIMIT } from '../../../shared/application/pagination';
import type { Clock, IdGenerator } from '../../../shared/application/ports';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors';
import { CATEGORIAS } from '../../../shared/motor/categorias';
import { gerarPlano } from '../../../shared/motor/motor';
import { Categoria, type CategoriasRepository } from '../../categorias';
import { CheckIn, type CheckInsRepository } from '../../check-ins';
import { Divida, type DividasRepository } from '../../dividas';
import { GastoFixo, type GastosFixosRepository } from '../../gastos-fixos';
import { Subscriber, type SubscribersRepository } from '../../identidade';
import { Meta, type MetasRepository } from '../../metas';
import { Perfil, type DadosPerfil, type PerfisRepository } from '../../perfil';
import { VersaoPlano, type PerfilDoMotor, type VersoesPlanoRepository } from '../../planos';
import type { DadosExportados } from './dados-exportados';
import { CONFIRMACAO_EXCLUSAO, MENSAGEM_CONFIRMACAO_EXCLUSAO, type ExcluirContaUseCase } from './excluir-conta.use-case';
import type { ExportarDadosUseCase } from './exportar-dados.use-case';

/*
  Contrato da privacidade: exportar e excluir se comportam igual com os
  repositórios em memória (privacidade.use-cases.test.ts) e com os do Prisma
  num Postgres de verdade (excluir-conta.integration.test.ts).

  Não é um arquivo .test.ts: é uma função que cada montagem chama. Também
  exporta a conta completa de teste (criarContaCompleta), a exportação que ela
  deve gerar e o retrato por módulo, que o teste HTTP reaproveita.
*/

export interface RepositoriosDaConta {
  subscribers: SubscribersRepository;
  perfis: PerfisRepository;
  categorias: CategoriasRepository;
  gastosFixos: GastosFixosRepository;
  dividas: DividasRepository;
  versoesPlano: VersoesPlanoRepository;
  metas: MetasRepository;
  checkIns: CheckInsRepository;
  ids: IdGenerator;
}

export interface PrivacidadeHarness extends RepositoriosDaConta {
  exportar: ExportarDadosUseCase;
  excluir: ExcluirContaUseCase;
  clock: Clock;
}

export interface PessoaDeTeste {
  email: string;
  /** entra no endereço público da meta, que é único entre todas as pessoas */
  apelido: string;
}

export const ANA: PessoaDeTeste = { email: 'ana@teste.dindin.dev', apelido: 'ana' };
export const BRUNO: PessoaDeTeste = { email: 'bruno@teste.dindin.dev', apelido: 'bruno' };

export interface ContaDeTeste {
  subscriberId: string;
  /** a categoria personalizada que tem gasto: a que o Restrict protege */
  categoriaComGastoId: string;
}

// ISO em vez de Date compartilhado: cada entidade recebe a sua instância
const EM = {
  cadastro: '2026-07-01T10:00:00.000Z',
  linkExpira: '2026-07-01T10:15:00.000Z',
  confirmacao: '2026-07-01T10:05:00.000Z',
  perfil: '2026-07-02T09:00:00.000Z',
  categoriaClube: '2026-07-02T09:10:00.000Z',
  categoriaPadaria: '2026-07-02T09:11:00.000Z',
  gastoMercado: '2026-07-02T09:20:00.000Z',
  gastoClube: '2026-07-02T09:21:00.000Z',
  dividaCartao: '2026-07-02T09:30:00.000Z',
  dividaEmprestimo: '2026-07-02T09:31:00.000Z',
  plano1: '2026-07-02T09:40:00.000Z',
  plano2: '2026-08-10T18:00:00.000Z',
  metaViagem: '2026-07-03T08:00:00.000Z',
  metaViagemPublicada: '2026-07-04T08:00:00.000Z',
  metaReserva: '2026-07-05T08:00:00.000Z',
  checkInJulho: '2026-08-01T12:00:00.000Z',
  checkInJulhoEnviado: '2026-08-01T12:01:00.000Z',
  checkInJulhoRespondido: '2026-08-03T20:00:00.000Z',
  checkInAgosto: '2026-09-01T12:00:00.000Z',
} as const;

const em = (momento: keyof typeof EM) => new Date(EM[momento]);

const PERFIL: DadosPerfil = {
  rendaMensal: 3200.5,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1100,
  guardado: 400.75,
};

/** o perfil completo que entrou no motor na primeira versão do plano */
export const ENTRADA_V1: PerfilDoMotor = {
  ...PERFIL,
  gastosFixos: [
    { categoria: 'mercado', valor: 650 },
    { categoria: 'outro', nome: 'Clube do bairro', valor: 45.9 },
  ],
  dividas: [
    { tipo: 'rotativo', saldo: 1800, parcela: 150 },
    { tipo: 'emprestimo', saldo: 3000.55, taxaAnual: 0.4512 },
  ],
};

/** um mês depois, com mais guardado */
const ENTRADA_V2: PerfilDoMotor = { ...ENTRADA_V1, guardado: 900 };

/** no formato em que o plano volta do JSONB (VersaoPlano.criar normaliza igual) */
const comoJson = <T>(valor: T): T => JSON.parse(JSON.stringify(valor)) as T;

/**
 * Uma conta com dado em todos os módulos: perfil, duas categorias personalizadas
 * (uma com gasto), um gasto do catálogo e um na personalizada, duas dívidas, duas
 * versões do plano, duas metas (uma publicada) e dois check-ins (um respondido).
 * Grava na ordem das FKs, como o app grava.
 */
export async function criarContaCompleta(r: RepositoriosDaConta, pessoa: PessoaDeTeste): Promise<ContaDeTeste> {
  const subscriberId = r.ids.generate();
  const conta = Subscriber.criar({
    id: subscriberId,
    email: pessoa.email,
    tokenHash: `hash-do-link-${pessoa.apelido}`,
    tokenExpiraEm: em('linkExpira'),
    agora: em('cadastro'),
  });
  conta.consumirLinkMagico(em('confirmacao'));
  await r.subscribers.save(conta);

  await r.perfis.save(Perfil.criar({ ...PERFIL, subscriberId, agora: em('perfil') }));

  const clube = Categoria.criarPersonalizada({
    id: r.ids.generate(),
    nome: 'Clube do bairro',
    subscriberId,
    agora: em('categoriaClube'),
  });
  await r.categorias.save(clube);
  await r.categorias.save(
    Categoria.criarPersonalizada({ id: r.ids.generate(), nome: 'Padaria', subscriberId, agora: em('categoriaPadaria') }),
  );

  const mercado = await r.categorias.findBySlug('mercado');
  if (!mercado) throw new Error('Catálogo sem "mercado": monte o repositório de categorias com o catálogo semeado');
  await r.gastosFixos.save(
    GastoFixo.criar({ id: r.ids.generate(), subscriberId, categoriaId: mercado.id, valor: 650, agora: em('gastoMercado') }),
  );
  await r.gastosFixos.save(
    GastoFixo.criar({ id: r.ids.generate(), subscriberId, categoriaId: clube.id, valor: 45.9, agora: em('gastoClube') }),
  );

  await r.dividas.save(
    Divida.criar({
      id: r.ids.generate(),
      subscriberId,
      tipo: 'rotativo',
      saldo: 1800,
      parcela: 150,
      taxaAnual: null,
      agora: em('dividaCartao'),
    }),
  );
  await r.dividas.save(
    Divida.criar({
      id: r.ids.generate(),
      subscriberId,
      tipo: 'emprestimo',
      saldo: 3000.55,
      parcela: null,
      taxaAnual: 0.4512,
      agora: em('dividaEmprestimo'),
    }),
  );

  for (const [versao, entrada, criadoEm] of [
    [1, ENTRADA_V1, em('plano1')],
    [2, ENTRADA_V2, em('plano2')],
  ] as const) {
    await r.versoesPlano.save(
      VersaoPlano.criar({
        id: r.ids.generate(),
        subscriberId,
        versao,
        inputSnap: entrada,
        resultado: gerarPlano(entrada),
        criadoEm,
      }),
    );
  }

  const viagem = Meta.criar({
    id: r.ids.generate(),
    subscriberId,
    nome: 'Viagem',
    valorAlvo: 10000,
    prazoMeses: 12,
    acumulado: 1500.25,
    agora: em('metaViagem'),
  });
  viagem.publicar(`viagem-${pessoa.apelido}`, em('metaViagemPublicada'));
  await r.metas.save(viagem);
  await r.metas.save(
    Meta.criar({
      id: r.ids.generate(),
      subscriberId,
      nome: 'Reserva de emergência',
      valorAlvo: 5000,
      aporteMensal: 300.5,
      agora: em('metaReserva'),
    }),
  );

  const julho = CheckIn.abrir({ id: r.ids.generate(), subscriberId, competencia: '2026-07', agora: em('checkInJulho') });
  julho.marcarEnviado(em('checkInJulhoEnviado'));
  julho.responder({ rendaReal: 3200.5, gastoReal: 2500.1, guardadoReal: 700.4 }, em('checkInJulhoRespondido'));
  await r.checkIns.save(julho);
  await r.checkIns.save(
    CheckIn.abrir({ id: r.ids.generate(), subscriberId, competencia: '2026-08', agora: em('checkInAgosto') }),
  );

  return { subscriberId, categoriaComGastoId: clube.id };
}

/** O que exportar a conta de criarContaCompleta tem que devolver, campo a campo e na ordem. */
export function exportacaoEsperada(pessoa: PessoaDeTeste, exportadoEm: Date): DadosExportados {
  return {
    exportadoEm,
    conta: { email: pessoa.email, criadoEm: em('cadastro'), emailVerificadoEm: em('confirmacao'), ativo: true },
    perfil: { ...PERFIL, atualizadoEm: em('perfil') },
    // do maior valor pro menor; a personalizada aparece pelo nome, como a do catálogo
    gastosFixos: [
      { categoria: 'Mercado', valor: 650, criadoEm: em('gastoMercado') },
      { categoria: 'Clube do bairro', valor: 45.9, criadoEm: em('gastoClube') },
    ],
    categoriasPersonalizadas: [
      { nome: 'Clube do bairro', criadoEm: em('categoriaClube') },
      { nome: 'Padaria', criadoEm: em('categoriaPadaria') },
    ],
    dividas: [
      { tipo: 'rotativo', saldo: 1800, parcela: 150, taxaAnual: null, criadoEm: em('dividaCartao') },
      { tipo: 'emprestimo', saldo: 3000.55, parcela: null, taxaAnual: 0.4512, criadoEm: em('dividaEmprestimo') },
    ],
    planos: [
      { versao: 2, criadoEm: em('plano2'), entrada: comoJson(ENTRADA_V2), resultado: comoJson(gerarPlano(ENTRADA_V2)) },
      { versao: 1, criadoEm: em('plano1'), entrada: comoJson(ENTRADA_V1), resultado: comoJson(gerarPlano(ENTRADA_V1)) },
    ],
    metas: [
      {
        nome: 'Reserva de emergência',
        valorAlvo: 5000,
        aporteMensal: 300.5,
        prazoMeses: null,
        acumulado: 0,
        publicSlug: null,
        criadoEm: em('metaReserva'),
        atualizadoEm: em('metaReserva'),
      },
      {
        nome: 'Viagem',
        valorAlvo: 10000,
        aporteMensal: null,
        prazoMeses: 12,
        acumulado: 1500.25,
        publicSlug: `viagem-${pessoa.apelido}`,
        criadoEm: em('metaViagem'),
        atualizadoEm: em('metaViagemPublicada'),
      },
    ],
    checkIns: [
      {
        competencia: '2026-08',
        rendaReal: null,
        gastoReal: null,
        guardadoReal: null,
        enviadoEm: null,
        respondidoEm: null,
        criadoEm: em('checkInAgosto'),
      },
      {
        competencia: '2026-07',
        rendaReal: 3200.5,
        gastoReal: 2500.1,
        guardadoReal: 700.4,
        enviadoEm: em('checkInJulhoEnviado'),
        respondidoEm: em('checkInJulhoRespondido'),
        criadoEm: em('checkInJulho'),
      },
    ],
  };
}

/** Quanto de cada módulo existe pra pessoa, lido pelos próprios repositórios. */
export async function retratoDa(r: RepositoriosDaConta, subscriberId: string) {
  const tudo = { limit: MAX_PAGE_LIMIT };
  return {
    conta: (await r.subscribers.findById(subscriberId)) !== null,
    perfil: await r.perfis.exists(subscriberId),
    gastosFixos: await r.gastosFixos.countBySubscriber(subscriberId),
    dividas: await r.dividas.countBySubscriber(subscriberId),
    categoriasPersonalizadas: await r.categorias.countCustom(subscriberId),
    planos: (await r.versoesPlano.list(subscriberId, tudo)).items.length,
    metas: await r.metas.countBySubscriber(subscriberId),
    checkIns: (await r.checkIns.list(subscriberId, tudo)).items.length,
  };
}

export const CONTA_COMPLETA: Awaited<ReturnType<typeof retratoDa>> = {
  conta: true,
  perfil: true,
  gastosFixos: 2,
  dividas: 2,
  categoriasPersonalizadas: 2,
  planos: 2,
  metas: 2,
  checkIns: 2,
};

export const CONTA_APAGADA: Awaited<ReturnType<typeof retratoDa>> = {
  conta: false,
  perfil: false,
  gastosFixos: 0,
  dividas: 0,
  categoriasPersonalizadas: 0,
  planos: 0,
  metas: 0,
  checkIns: 0,
};

/** Todas as chaves de um JSON, em qualquer profundidade. */
export function chavesDoJson(valor: unknown): Set<string> {
  const chaves = new Set<string>();
  const visitar = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(visitar);
    } else if (typeof v === 'object' && v !== null) {
      for (const [chave, filho] of Object.entries(v)) {
        chaves.add(chave);
        visitar(filho);
      }
    }
  };
  visitar(valor);
  return chaves;
}

/** Nomes de campo que nunca podem sair num arquivo de exportação. */
export const CAMPOS_INTERNOS = ['id', 'subscriberId', 'profileId', 'categoriaId', 'tokenHash', 'token', 'tokenExpiraEm'];

export function describePrivacidadeContract(nome: string, setup: () => Promise<PrivacidadeHarness>) {
  describe(`Privacidade — ${nome}`, () => {
    let h: PrivacidadeHarness;

    beforeEach(async () => {
      h = await setup();
    });

    describe('ExportarDadosUseCase', () => {
      it('exporta tudo da pessoa, inclusive o gasto em categoria personalizada, campo a campo e na ordem', async () => {
        const ana = await criarContaCompleta(h, ANA);
        await criarContaCompleta(h, BRUNO);

        const dados = await h.exportar.execute({ subscriberId: ana.subscriberId });
        expect(dados).toEqual(exportacaoEsperada(ANA, h.clock.now()));
      });

      it('nada de outra pessoa, nenhum id interno e nenhum hash de token', async () => {
        const ana = await criarContaCompleta(h, ANA);
        const bruno = await criarContaCompleta(h, BRUNO);

        const json = JSON.parse(JSON.stringify(await h.exportar.execute({ subscriberId: ana.subscriberId }))) as unknown;
        const texto = JSON.stringify(json);
        for (const proibido of [
          BRUNO.email,
          `viagem-${BRUNO.apelido}`,
          bruno.subscriberId,
          ana.subscriberId,
          ana.categoriaComGastoId,
          'hash-do-link',
          'consumido:',
        ]) {
          expect(texto).not.toContain(proibido);
        }
        const chaves = chavesDoJson(json);
        expect(CAMPOS_INTERNOS.filter((campo) => chaves.has(campo))).toEqual([]);
      });

      it('conta só com o cadastro: perfil null e listas vazias', async () => {
        const subscriberId = h.ids.generate();
        const conta = Subscriber.criar({
          id: subscriberId,
          email: 'so-cadastro@teste.dindin.dev',
          tokenHash: 'hash-do-link-so-cadastro',
          tokenExpiraEm: em('linkExpira'),
          agora: em('cadastro'),
        });
        await h.subscribers.save(conta);
        await criarContaCompleta(h, BRUNO);

        expect(await h.exportar.execute({ subscriberId })).toEqual({
          exportadoEm: h.clock.now(),
          conta: { email: 'so-cadastro@teste.dindin.dev', criadoEm: em('cadastro'), emailVerificadoEm: null, ativo: true },
          perfil: null,
          gastosFixos: [],
          categoriasPersonalizadas: [],
          dividas: [],
          planos: [],
          metas: [],
          checkIns: [],
        });
      });

      it('conta que não existe → NotFound', async () => {
        await expect(h.exportar.execute({ subscriberId: h.ids.generate() })).rejects.toThrow(
          new NotFoundError('Conta não encontrada.'),
        );
      });
    });

    describe('ExcluirContaUseCase', () => {
      it('apaga tudo da pessoa e nada da outra; o catálogo continua inteiro', async () => {
        const ana = await criarContaCompleta(h, ANA);
        const bruno = await criarContaCompleta(h, BRUNO);
        expect(await retratoDa(h, ana.subscriberId)).toEqual(CONTA_COMPLETA);

        await h.excluir.execute({ subscriberId: ana.subscriberId, confirmacao: CONFIRMACAO_EXCLUSAO });

        expect(await retratoDa(h, ana.subscriberId)).toEqual(CONTA_APAGADA);
        expect(await retratoDa(h, bruno.subscriberId)).toEqual(CONTA_COMPLETA);
        expect(await h.exportar.execute({ subscriberId: bruno.subscriberId })).toEqual(exportacaoEsperada(BRUNO, h.clock.now()));
        expect(await h.categorias.listVisible(null)).toHaveLength(CATEGORIAS.length);
      });

      it('gasto em categoria personalizada não barra a exclusão; na ordem errada, o Restrict barraria', async () => {
        const ana = await criarContaCompleta(h, ANA);
        // prova que o Restrict de gastos_fixos.categoria_id vale nesta montagem: apagar as categorias antes dos gastos falha
        await expect(h.categorias.deleteAllCustom(ana.subscriberId)).rejects.toBeInstanceOf(ConflictError);
        expect(await h.categorias.findById(ana.categoriaComGastoId)).not.toBeNull();

        await h.excluir.execute({ subscriberId: ana.subscriberId, confirmacao: CONFIRMACAO_EXCLUSAO });
        expect(await h.categorias.findById(ana.categoriaComGastoId)).toBeNull();
        expect(await retratoDa(h, ana.subscriberId)).toEqual(CONTA_APAGADA);
      });

      it.each(['', 'excluir', ' EXCLUIR', 'EXCLUIR ', 'SIM'])(
        'confirmação %j → ValidationError no campo, e nada é apagado',
        async (confirmacao) => {
          const ana = await criarContaCompleta(h, ANA);
          const falha = h.excluir.execute({ subscriberId: ana.subscriberId, confirmacao });

          await expect(falha).rejects.toBeInstanceOf(ValidationError);
          await expect(falha).rejects.toMatchObject({ details: { confirmacao: MENSAGEM_CONFIRMACAO_EXCLUSAO } });
          expect(await retratoDa(h, ana.subscriberId)).toEqual(CONTA_COMPLETA);
        },
      );

      it('depois de excluir: exportar dá NotFound, e o e-mail e o endereço público da meta ficam livres', async () => {
        const ana = await criarContaCompleta(h, ANA);
        await h.excluir.execute({ subscriberId: ana.subscriberId, confirmacao: CONFIRMACAO_EXCLUSAO });

        await expect(h.exportar.execute({ subscriberId: ana.subscriberId })).rejects.toBeInstanceOf(NotFoundError);
        expect(await h.subscribers.findByEmail(ANA.email)).toBeNull();
        expect(await h.metas.isPublicSlugTaken(`viagem-${ANA.apelido}`)).toBe(false);

        // a pessoa pode voltar do zero com o mesmo e-mail
        const deNovo = await criarContaCompleta(h, ANA);
        expect(await retratoDa(h, deNovo.subscriberId)).toEqual(CONTA_COMPLETA);
      });

      it('idempotente: excluir de novo, ou uma conta que não existe, não falha', async () => {
        const ana = await criarContaCompleta(h, ANA);
        const bruno = await criarContaCompleta(h, BRUNO);
        await h.excluir.execute({ subscriberId: ana.subscriberId, confirmacao: CONFIRMACAO_EXCLUSAO });

        await expect(
          h.excluir.execute({ subscriberId: ana.subscriberId, confirmacao: CONFIRMACAO_EXCLUSAO }),
        ).resolves.toBeUndefined();
        await expect(
          h.excluir.execute({ subscriberId: h.ids.generate(), confirmacao: CONFIRMACAO_EXCLUSAO }),
        ).resolves.toBeUndefined();
        expect(await retratoDa(h, bruno.subscriberId)).toEqual(CONTA_COMPLETA);
      });
    });
  });
}
