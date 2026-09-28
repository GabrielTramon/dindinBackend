import { beforeEach, describe, expect, it } from 'vitest';
import { BusinessRuleError, ConflictError } from '../../../../shared/domain/errors';
import { Divida, type DadosDivida } from '../../domain/divida';
import type { DividasRepository } from '../../domain/dividas-repository';

/*
  Contrato de DividasRepository: o mesmo comportamento pra qualquer
  implementação. Roda contra a versão em memória (in-memory-dividas-repository.test.ts)
  e contra a do Prisma num Postgres de verdade (*.integration.test.ts).

  Não é um arquivo .test.ts: é uma função que cada implementação chama.
*/

export interface DividasRepositoryHarness {
  repo: DividasRepository;
  /** subscriber com perfil (a FK da dívida aponta pro perfil); devolve o subscriberId */
  criarPerfil(): Promise<string>;
  /** subscriber que ainda não criou o perfil: a FK recusa dívida dele */
  criarSubscriberSemPerfil(): Promise<string>;
}

const agora = new Date('2026-09-17T12:00:00.000Z');
const minutos = (n: number) => new Date(agora.getTime() + n * 60_000);
let sequencia = 0;
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

export function describeDividasRepositoryContract(nome: string, setup: () => Promise<DividasRepositoryHarness>) {
  describe(`DividasRepository — ${nome}`, () => {
    let h: DividasRepositoryHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const divida = (
      subscriberId: string,
      dados: Partial<DadosDivida> = {},
      extra: { id?: string; criadoEm?: Date } = {},
    ) =>
      Divida.criar({
        id: extra.id ?? novoId(),
        subscriberId,
        tipo: dados.tipo ?? 'emprestimo',
        saldo: dados.saldo ?? 1000,
        parcela: dados.parcela === undefined ? 100 : dados.parcela,
        taxaAnual: dados.taxaAnual === undefined ? 0.45 : dados.taxaAnual,
        agora: extra.criadoEm ?? agora,
      });

    const ids = async (subscriberId: string) => (await h.repo.listBySubscriber(subscriberId)).map((d) => d.id);

    it('perfil sem dívidas: lista vazia e contagem zero', async () => {
      const sub = await h.criarPerfil();
      expect(await h.repo.listBySubscriber(sub)).toEqual([]);
      expect(await h.repo.countBySubscriber(sub)).toBe(0);
    });

    it('save + findById devolvem todos os campos iguais, decimais inclusive (1500.10 e 0.8765)', async () => {
      const sub = await h.criarPerfil();
      const d = divida(sub, { tipo: 'cheque_especial', saldo: 1500.1, parcela: 19.99, taxaAnual: 0.8765 });
      await h.repo.save(d);

      const lida = await h.repo.findById(d.id, sub);
      expect(lida?.toSnapshot()).toEqual(d.toSnapshot());
      expect(lida?.saldo).toBe(1500.1);
      expect(lida?.taxaAnual).toBe(0.8765);
    });

    it('parcela e taxa null fazem o caminho de ida e volta como null, nunca 0', async () => {
      const sub = await h.criarPerfil();
      const d = divida(sub, { tipo: 'rotativo', parcela: null, taxaAnual: null });
      await h.repo.save(d);

      const lida = await h.repo.findById(d.id, sub);
      expect(lida?.parcela).toBeNull();
      expect(lida?.taxaAnual).toBeNull();
      expect(lida?.tipo).toBe('rotativo');
    });

    it('save insere e depois atualiza a mesma linha, inclusive limpando parcela e taxa', async () => {
      const sub = await h.criarPerfil();
      const d = divida(sub, { parcela: 250, taxaAnual: 0.9 });
      await h.repo.save(d);
      d.atualizar({ tipo: 'financiamento', saldo: 800.5, parcela: null, taxaAnual: null });
      await h.repo.save(d);

      expect(await h.repo.countBySubscriber(sub)).toBe(1);
      expect((await h.repo.findById(d.id, sub))?.toSnapshot()).toEqual({
        id: d.id,
        subscriberId: sub,
        tipo: 'financiamento',
        saldo: 800.5,
        parcela: null,
        taxaAnual: null,
        criadoEm: agora,
      });
    });

    it('mutar a entidade sem save não altera o que está gravado', async () => {
      const sub = await h.criarPerfil();
      const d = divida(sub, { saldo: 1000 });
      await h.repo.save(d);
      d.atualizar({ saldo: 1 });
      expect((await h.repo.findById(d.id, sub))?.saldo).toBe(1000);

      // e o que sai do repositório também é cópia
      const lida = await h.repo.findById(d.id, sub);
      lida?.atualizar({ saldo: 2 });
      expect((await h.repo.findById(d.id, sub))?.saldo).toBe(1000);
    });

    it('lista por criadoEm crescente; no empate, por id crescente', async () => {
      const sub = await h.criarPerfil();
      const [id1, id2, id3] = [novoId(), novoId(), novoId()];
      // gravadas fora de ordem de propósito
      await h.repo.save(divida(sub, {}, { id: id3, criadoEm: minutos(5) }));
      await h.repo.save(divida(sub, {}, { id: id2, criadoEm: minutos(1) }));
      await h.repo.save(divida(sub, {}, { id: id1, criadoEm: minutos(5) }));
      const antiga = divida(sub, {}, { criadoEm: minutos(-10) });
      await h.repo.save(antiga);

      expect(await ids(sub)).toEqual([antiga.id, id2, id1, id3]);
    });

    it('escopo: dívida de outra pessoa nunca aparece em list, find nem count', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const deA = divida(a);
      const deB = divida(b);
      await h.repo.save(deA);
      await h.repo.save(deB);

      expect(await ids(a)).toEqual([deA.id]);
      expect(await h.repo.countBySubscriber(a)).toBe(1);
      expect(await h.repo.findById(deB.id, a)).toBeNull();
      expect(await h.repo.findById(deA.id, a)).not.toBeNull();
    });

    it('findById de id inexistente devolve null', async () => {
      const sub = await h.criarPerfil();
      expect(await h.repo.findById(novoId(), sub)).toBeNull();
    });

    it('save sem perfil (FK) → BusinessRuleError e nada é gravado', async () => {
      const sub = await h.criarSubscriberSemPerfil();
      const d = divida(sub);
      await expect(h.repo.save(d)).rejects.toThrow(new BusinessRuleError('Crie seu perfil antes de adicionar dívidas.'));
      expect(await h.repo.countBySubscriber(sub)).toBe(0);
    });

    it('save com o id de uma dívida de outra pessoa → ConflictError e a dela fica intacta', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const deA = divida(a, { saldo: 1000 });
      await h.repo.save(deA);

      const intrusa = divida(b, { saldo: 1 }, { id: deA.id });
      await expect(h.repo.save(intrusa)).rejects.toBeInstanceOf(ConflictError);
      expect((await h.repo.findById(deA.id, a))?.saldo).toBe(1000);
      expect(await h.repo.countBySubscriber(b)).toBe(0);
    });

    it('delete é escopado pelo dono e idempotente', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const deA = divida(a);
      await h.repo.save(deA);

      await expect(h.repo.delete(deA.id, b)).resolves.toBeUndefined();
      expect(await h.repo.findById(deA.id, a)).not.toBeNull();

      await h.repo.delete(deA.id, a);
      expect(await h.repo.findById(deA.id, a)).toBeNull();
      await expect(h.repo.delete(deA.id, a)).resolves.toBeUndefined();
      await expect(h.repo.delete(novoId(), a)).resolves.toBeUndefined();
    });

    it('replaceAll troca a lista inteira só daquela pessoa; empate de criadoEm sai por id', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      await h.repo.save(divida(a));
      await h.repo.save(divida(a));
      const deB = divida(b);
      await h.repo.save(deB);

      const [menor, maior] = [novoId(), novoId()];
      // mesmo instante (como o PUT do perfil completo grava) e fora de ordem
      const mesmoInstante = minutos(30);
      const novas = [
        divida(a, { tipo: 'rotativo', saldo: 2500.55, parcela: null, taxaAnual: null }, { id: maior, criadoEm: mesmoInstante }),
        divida(a, { tipo: 'outra', saldo: 300, parcela: 50, taxaAnual: 0.1234 }, { id: menor, criadoEm: mesmoInstante }),
      ];
      await h.repo.replaceAll(a, novas);

      const lista = await h.repo.listBySubscriber(a);
      expect(lista.map((d) => d.toSnapshot())).toEqual([novas[1]!.toSnapshot(), novas[0]!.toSnapshot()]);
      expect(await ids(b)).toEqual([deB.id]);
    });

    it('replaceAll pode manter ids que já eram da própria pessoa', async () => {
      const sub = await h.criarPerfil();
      const d = divida(sub, { saldo: 1000 });
      await h.repo.save(d);
      d.atualizar({ saldo: 900 });

      await h.repo.replaceAll(sub, [d]);
      expect((await h.repo.listBySubscriber(sub)).map((x) => x.toSnapshot())).toEqual([d.toSnapshot()]);
    });

    it('replaceAll com lista vazia apaga todas as da pessoa', async () => {
      const sub = await h.criarPerfil();
      await h.repo.save(divida(sub));
      await h.repo.save(divida(sub));

      await h.repo.replaceAll(sub, []);
      expect(await h.repo.countBySubscriber(sub)).toBe(0);
    });

    it('replaceAll sem perfil (FK) → BusinessRuleError', async () => {
      const sub = await h.criarSubscriberSemPerfil();
      await expect(h.repo.replaceAll(sub, [divida(sub)])).rejects.toBeInstanceOf(BusinessRuleError);
      expect(await h.repo.countBySubscriber(sub)).toBe(0);
    });

    it('replaceAll é todas ou nenhuma: uma dívida que colide → ConflictError e a lista antiga continua', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const antiga = divida(a, { saldo: 700 });
      await h.repo.save(antiga);
      const deB = divida(b);
      await h.repo.save(deB);

      // a segunda reaproveita o id de uma dívida de B: o INSERT falha depois do DELETE
      const novas = [divida(a, { saldo: 1 }), divida(a, { saldo: 2 }, { id: deB.id })];
      await expect(h.repo.replaceAll(a, novas)).rejects.toBeInstanceOf(ConflictError);

      expect((await h.repo.listBySubscriber(a)).map((d) => d.toSnapshot())).toEqual([antiga.toSnapshot()]);
      expect((await h.repo.findById(deB.id, b))?.subscriberId).toBe(b);
    });

    it('replaceAll recusa dívida de outro subscriber na lista, sem mexer em nada', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const antiga = divida(a);
      await h.repo.save(antiga);

      await expect(h.repo.replaceAll(a, [divida(a), divida(b)])).rejects.toThrow('outro subscriber');
      expect(await ids(a)).toEqual([antiga.id]);
      expect(await h.repo.countBySubscriber(b)).toBe(0);
    });

    it('deleteAllBySubscriber apaga só as daquela pessoa', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      await h.repo.save(divida(a));
      await h.repo.save(divida(a));
      await h.repo.save(divida(b));

      await h.repo.deleteAllBySubscriber(a);
      expect(await h.repo.countBySubscriber(a)).toBe(0);
      expect(await h.repo.countBySubscriber(b)).toBe(1);
      await expect(h.repo.deleteAllBySubscriber(a)).resolves.toBeUndefined();
    });
  });
}
