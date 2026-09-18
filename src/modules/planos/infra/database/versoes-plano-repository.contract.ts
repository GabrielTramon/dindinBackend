import { beforeEach, describe, expect, it } from 'vitest';
import { encodeCursor } from '../../../../shared/application/pagination';
import { ConflictError, ValidationError } from '../../../../shared/domain/errors';
import { gerarPlano } from '../../../../shared/motor/motor';
import { MAX_VERSAO, VersaoPlano, type PerfilDoMotor } from '../../domain/versao-plano';
import type { VersoesPlanoRepository } from '../../domain/versoes-plano-repository';

/*
  Contrato de VersoesPlanoRepository: o mesmo comportamento pra qualquer
  implementação. Roda contra a versão em memória (in-memory-versoes-plano-repository.test.ts)
  e contra a do Prisma num Postgres de verdade (*.integration.test.ts).

  Não é um arquivo .test.ts: é uma função que cada implementação chama.
*/

export interface VersoesPlanoRepositoryHarness {
  repo: VersoesPlanoRepository;
  /** cria um subscriber válido (no Prisma, a FK exige que ele exista) e devolve o id */
  criarSubscriber(): Promise<string>;
}

const agora = new Date('2026-09-17T12:00:00.000Z');
let sequencia = 0;
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

/** CLT morando de aluguel, com cartão rodando e um gasto de nome livre (acento de propósito). */
const PERFIL_COM_DIVIDA: PerfilDoMotor = {
  rendaMensal: 3200,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1100,
  gastosFixos: [
    { categoria: 'mercado', valor: 650 },
    { categoria: 'internet', valor: 99.9 },
    { categoria: 'transporte_publico', valor: 220 },
    { categoria: 'outro', nome: 'Clube do bairro — sócio', valor: 45 },
  ],
  dividas: [
    { tipo: 'rotativo', saldo: 1800, parcela: 150 },
    { tipo: 'financiamento', saldo: 22000.5, parcela: 890, taxaAnual: 0.2345 },
  ],
  guardado: 400,
};

/** Gasta mais do que ganha: o plano vem em modo corte, com sugestões e `corte` preenchido. */
const PERFIL_EM_CORTE: PerfilDoMotor = {
  rendaMensal: 1900,
  tipoRenda: 'informal',
  idade: 19,
  moradia: 'dividido',
  custoMoradia: 1200,
  gastosFixos: [
    { categoria: 'celular', valor: 60 },
    { categoria: 'streaming', valor: 55.8 },
    { categoria: 'combustivel', valor: 700 },
  ],
  dividas: [{ tipo: 'cheque_especial', saldo: 950 }],
  guardado: 0,
};

export function describeVersoesPlanoRepositoryContract(
  nome: string,
  setup: () => Promise<VersoesPlanoRepositoryHarness>,
) {
  describe(`VersoesPlanoRepository — ${nome}`, () => {
    let h: VersoesPlanoRepositoryHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const versaoDe = (
      subscriberId: string,
      versao: number,
      perfil: PerfilDoMotor = PERFIL_COM_DIVIDA,
      criadoEm: Date = agora,
    ) =>
      VersaoPlano.criar({
        id: novoId(),
        subscriberId,
        versao,
        inputSnap: perfil,
        resultado: gerarPlano(structuredClone(perfil)),
        criadoEm,
      });

    const salvarVersoes = async (subscriberId: string, versoes: number[]) => {
      for (const v of versoes) await h.repo.save(versaoDe(subscriberId, v));
    };

    it('nextVersion é 1 sem nada gravado e maior versão + 1 depois (não a contagem)', async () => {
      const sub = await h.criarSubscriber();
      expect(await h.repo.nextVersion(sub)).toBe(1);
      await salvarVersoes(sub, [1]);
      expect(await h.repo.nextVersion(sub)).toBe(2);
      await salvarVersoes(sub, [5]);
      expect(await h.repo.nextVersion(sub)).toBe(6);
    });

    it('versões de pessoas diferentes são independentes: cada uma tem a sua versão 1', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await salvarVersoes(a, [1, 2]);
      expect(await h.repo.nextVersion(b)).toBe(1);
      await expect(h.repo.save(versaoDe(b, 1))).resolves.toBeUndefined();
      expect(await h.repo.nextVersion(a)).toBe(3);
      expect(await h.repo.nextVersion(b)).toBe(2);
    });

    it('mesma versão pra mesma pessoa → ConflictError e a gravada continua intacta', async () => {
      const sub = await h.criarSubscriber();
      const original = versaoDe(sub, 1);
      await h.repo.save(original);

      await expect(h.repo.save(versaoDe(sub, 1, PERFIL_EM_CORTE))).rejects.toBeInstanceOf(ConflictError);
      const lida = await h.repo.findByVersion(sub, 1);
      expect(lida?.id).toBe(original.id);
      expect(lida?.inputSnap).toEqual(PERFIL_COM_DIVIDA);
      expect(await h.repo.nextVersion(sub)).toBe(2);
    });

    it('save não sobrescreve: mesmo id → ConflictError (versões são imutáveis)', async () => {
      const sub = await h.criarSubscriber();
      const v1 = versaoDe(sub, 1);
      await h.repo.save(v1);
      const mesmoId = VersaoPlano.criar({ ...v1.toSnapshot(), versao: 2, inputSnap: PERFIL_EM_CORTE });
      await expect(h.repo.save(mesmoId)).rejects.toBeInstanceOf(ConflictError);
      expect((await h.repo.findByVersion(sub, 1))?.inputSnap).toEqual(PERFIL_COM_DIVIDA);
      expect(await h.repo.findByVersion(sub, 2)).toBeNull();
    });

    it('findByVersion acha a da pessoa; de outra pessoa, inexistente ou fora do intervalo do banco → null', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const v1 = versaoDe(a, 1);
      await h.repo.save(v1);

      expect((await h.repo.findByVersion(a, 1))?.id).toBe(v1.id);
      expect(await h.repo.findByVersion(b, 1)).toBeNull();
      expect(await h.repo.findByVersion(a, 2)).toBeNull();
      expect(await h.repo.findByVersion(a, MAX_VERSAO + 1)).toBeNull();
      expect(await h.repo.findByVersion(a, 1.5)).toBeNull();
    });

    it('findLatest: null sem nada; a maior versão (não a última gravada); nunca a de outra pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      expect(await h.repo.findLatest(a)).toBeNull();

      await salvarVersoes(a, [2, 1]);
      await salvarVersoes(b, [7]);
      expect((await h.repo.findLatest(a))?.versao).toBe(2);
      expect((await h.repo.findLatest(a))?.subscriberId).toBe(a);
    });

    /*
      O primeiro instante de setembro em São Paulo — o que `check-ins` calcula
      como fimDaCompetencia('2026-08'). Literal de propósito: o grafo não deixa
      `planos` importar `check-ins` (nem em teste), e o valor é provado em
      check-ins/domain/check-in.test.ts.
    */
    const FIM_DE_AGOSTO = new Date('2026-09-01T03:00:00.000Z');

    it('findEmVigorEm: a última gravada ANTES do instante; o milissegundo do corte já é do mês seguinte', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(versaoDe(sub, 1, PERFIL_COM_DIVIDA, new Date('2026-09-01T02:59:59.999Z')));
      await h.repo.save(versaoDe(sub, 2, PERFIL_EM_CORTE, FIM_DE_AGOSTO));

      // trocar o ritmo em setembro não reescreve o veredito de agosto
      const emAgosto = await h.repo.findEmVigorEm(sub, FIM_DE_AGOSTO);
      expect(emAgosto?.versao).toBe(1);
      expect(emAgosto?.inputSnap).toEqual(PERFIL_COM_DIVIDA);
      // setembro, esse sim, é medido pela versão nova
      expect((await h.repo.findEmVigorEm(sub, new Date('2026-10-01T03:00:00.000Z')))?.versao).toBe(2);
    });

    it('findEmVigorEm sem nenhuma versão até lá → a MAIS ANTIGA (cadastro em setembro respondendo agosto)', async () => {
      const sub = await h.criarSubscriber();
      // gravadas fora de ordem: a "mais antiga" é a menor versão, não a primeira gravada
      await h.repo.save(versaoDe(sub, 2, PERFIL_EM_CORTE, new Date('2026-09-18T12:00:00.000Z')));
      await h.repo.save(versaoDe(sub, 1, PERFIL_COM_DIVIDA, new Date('2026-09-17T12:00:00.000Z')));

      const plano = await h.repo.findEmVigorEm(sub, FIM_DE_AGOSTO);
      expect(plano?.versao).toBe(1);
      expect(plano?.inputSnap).toEqual(PERFIL_COM_DIVIDA);
    });

    it('findEmVigorEm: sem plano nenhum é null e nunca devolve o de outra pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      expect(await h.repo.findEmVigorEm(a, FIM_DE_AGOSTO)).toBeNull();

      await h.repo.save(versaoDe(b, 1, PERFIL_COM_DIVIDA, new Date('2026-08-10T12:00:00.000Z')));
      expect(await h.repo.findEmVigorEm(a, FIM_DE_AGOSTO)).toBeNull();
      expect((await h.repo.findEmVigorEm(b, FIM_DE_AGOSTO))?.subscriberId).toBe(b);
    });

    it('list: da mais nova pra mais antiga, paginada por cursor, só as da pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      // gravadas fora de ordem e todas com o mesmo criadoEm: a ordem é pela versão
      await salvarVersoes(a, [3, 1, 5, 2, 4]);
      await salvarVersoes(b, [1, 2, 3, 4, 5, 6]);

      const p1 = await h.repo.list(a, { limit: 2 });
      expect(p1.items.map((v) => v.versao)).toEqual([5, 4]);
      expect(p1.nextCursor).not.toBeNull();

      const p2 = await h.repo.list(a, { limit: 2, cursor: p1.nextCursor });
      expect(p2.items.map((v) => v.versao)).toEqual([3, 2]);

      const p3 = await h.repo.list(a, { limit: 2, cursor: p2.nextCursor });
      expect(p3.items.map((v) => v.versao)).toEqual([1]);
      expect(p3.nextCursor).toBeNull();

      expect([...p1.items, ...p2.items, ...p3.items].every((v) => v.subscriberId === a)).toBe(true);
    });

    it('list é estável: versão nova gravada entre as páginas não repete nem pula item', async () => {
      const sub = await h.criarSubscriber();
      await salvarVersoes(sub, [1, 2, 3, 4]);

      const p1 = await h.repo.list(sub, { limit: 2 });
      await salvarVersoes(sub, [5]);
      const p2 = await h.repo.list(sub, { limit: 2, cursor: p1.nextCursor });

      expect(p1.items.map((v) => v.versao)).toEqual([4, 3]);
      expect(p2.items.map((v) => v.versao)).toEqual([2, 1]);
      expect(p2.nextCursor).toBeNull();
    });

    it('list: página exata não promete próxima; sem versões devolve vazio', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await salvarVersoes(a, [1, 2]);
      expect(await h.repo.list(a, { limit: 2 })).toMatchObject({ nextCursor: null });
      expect(await h.repo.list(b, { limit: 10 })).toEqual({ items: [], nextCursor: null });
    });

    it.each(['lixo!!', encodeCursor('abc'), encodeCursor('0'), encodeCursor('-1'), encodeCursor('2.5')])(
      'list com cursor ilegível %j → ValidationError',
      async (cursor) => {
        const sub = await h.criarSubscriber();
        await salvarVersoes(sub, [1]);
        await expect(h.repo.list(sub, { limit: 10, cursor })).rejects.toBeInstanceOf(ValidationError);
      },
    );

    it('list com cursor acima de qualquer versão possível começa do topo, sem erro de banco', async () => {
      const sub = await h.criarSubscriber();
      await salvarVersoes(sub, [1, 2]);
      const page = await h.repo.list(sub, { limit: 10, cursor: encodeCursor(9_999_999_999_999) });
      expect(page.items.map((v) => v.versao)).toEqual([2, 1]);
    });

    it('JSON profundo volta igual: entrada, resultado (listas, null, acentos, decimais) e data', async () => {
      const sub = await h.criarSubscriber();
      const comDivida = versaoDe(sub, 1, PERFIL_COM_DIVIDA);
      const emCorte = versaoDe(sub, 2, PERFIL_EM_CORTE);
      await h.repo.save(comDivida);
      await h.repo.save(emCorte);

      const lida1 = await h.repo.findByVersion(sub, 1);
      const lida2 = await h.repo.findByVersion(sub, 2);
      // toEqual, não JSON.stringify: o JSONB reordena as chaves
      expect(lida1?.inputSnap).toEqual(PERFIL_COM_DIVIDA);
      expect(lida1?.resultado).toEqual(comDivida.resultado);
      expect(lida1?.criadoEm).toEqual(agora);
      expect(lida2?.resultado).toEqual(emCorte.resultado);

      // o cenário cobre o que o JSON precisa aguentar
      expect(lida1?.resultado.corte).toBeNull();
      expect(lida1?.resultado.dividas.caras.length).toBeGreaterThan(0);
      expect(lida2?.resultado.modoCorte).toBe(true);
      expect(lida2?.resultado.corte?.sugestoes.length).toBeGreaterThan(0);
      expect(lida1?.inputSnap.gastosFixos[3]?.nome).toBe('Clube do bairro — sócio');
    });

    it('chave opcional ausente continua ausente nas duas implementações (entrada normalizada)', async () => {
      const sub = await h.criarSubscriber();
      const perfil = {
        ...PERFIL_EM_CORTE,
        dividas: [{ tipo: 'cheque_especial' as const, saldo: 950, parcela: undefined, taxaAnual: undefined }],
      };
      await h.repo.save(versaoDe(sub, 1, perfil));
      const lida = await h.repo.findLatest(sub);
      expect(Object.keys(lida?.inputSnap.dividas[0] ?? {}).sort()).toEqual(['saldo', 'tipo']);
    });

    it('mexer no que saiu da entidade (gravada ou lida) não altera o que está gravado', async () => {
      const sub = await h.criarSubscriber();
      const v = versaoDe(sub, 1);
      await h.repo.save(v);

      v.toSnapshot().inputSnap.rendaMensal = 1;
      const lida = await h.repo.findLatest(sub);
      lida?.inputSnap.gastosFixos.pop();
      lida?.resultado.alocacoes.splice(0);
      lida?.toSnapshot().resultado.proximosPassos.push('não salvo');

      const deNovo = await h.repo.findLatest(sub);
      expect(deNovo?.inputSnap).toEqual(PERFIL_COM_DIVIDA);
      expect(deNovo?.resultado).toEqual(v.resultado);
    });

    it('deleteAllBySubscriber apaga só as versões daquela pessoa; sem versões não falha', async () => {
      const [a, b, c] = [await h.criarSubscriber(), await h.criarSubscriber(), await h.criarSubscriber()];
      await salvarVersoes(a, [1, 2]);
      await salvarVersoes(b, [1]);

      await h.repo.deleteAllBySubscriber(a);
      await expect(h.repo.deleteAllBySubscriber(c)).resolves.toBeUndefined();

      expect(await h.repo.findLatest(a)).toBeNull();
      expect(await h.repo.nextVersion(a)).toBe(1);
      expect((await h.repo.findLatest(b))?.versao).toBe(1);
    });
  });
}
