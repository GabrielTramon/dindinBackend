import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../../../../shared/domain/errors';
import { Meta } from '../../domain/meta';
import type { MetasRepository } from '../../domain/metas-repository';

/*
  Contrato de MetasRepository: o mesmo comportamento pra qualquer implementação.
  Roda contra a versão em memória (in-memory-metas-repository.test.ts) e contra a
  do Prisma num Postgres de verdade (prisma-metas-repository.integration.test.ts).

  Não é um arquivo .test.ts: é uma função que cada implementação chama.
*/

export interface MetasRepositoryHarness {
  repo: MetasRepository;
  /** cria um subscriber válido (no Prisma, a FK exige que ele exista) e devolve o id */
  criarSubscriber(): Promise<string>;
}

// milissegundos diferentes de zero: o TIMESTAMP(3) do banco precisa devolver a data exata
const agora = new Date('2026-09-17T12:00:00.123Z');
const minutos = (n: number) => new Date(agora.getTime() + n * 60_000);

let sequencia = 0;
// ids com cara de UUID, como os de produção: ordenam igual em qualquer collation
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

export function describeMetasRepositoryContract(nome: string, setup: () => Promise<MetasRepositoryHarness>) {
  describe(`MetasRepository — ${nome}`, () => {
    let h: MetasRepositoryHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const metaPorAporte = (subscriberId: string, extra: { id?: string; nome?: string; criadoEm?: Date } = {}) =>
      Meta.criar({
        id: extra.id ?? novoId(),
        subscriberId,
        nome: extra.nome ?? 'Viagem',
        valorAlvo: 10000,
        aporteMensal: 500,
        agora: extra.criadoEm ?? agora,
      });

    const publicada = (subscriberId: string, slug: string) => {
      const m = metaPorAporte(subscriberId);
      m.publicar(slug, agora);
      return m;
    };

    it('grava e lê de volta todos os campos, com centavos e datas exatas — modo aporte', async () => {
      const sub = await h.criarSubscriber();
      const m = Meta.criar({
        id: novoId(),
        subscriberId: sub,
        nome: 'Carro',
        valorAlvo: 45999.99,
        aporteMensal: 1234.56,
        acumulado: 0.07,
        agora,
      });
      await h.repo.save(m);
      expect((await h.repo.findById(m.id, sub))?.toSnapshot()).toEqual(m.toSnapshot());
    });

    it('grava e lê de volta todos os campos — modo prazo, publicada, no teto do dinheiro', async () => {
      const sub = await h.criarSubscriber();
      const m = Meta.criar({
        id: novoId(),
        subscriberId: sub,
        nome: 'Casa',
        valorAlvo: 9_999_999_999.99,
        prazoMeses: 1200,
        acumulado: 19.99,
        agora,
      });
      m.publicar('casa-abc123', minutos(5));
      await h.repo.save(m);
      const lida = await h.repo.findById(m.id, sub);
      expect(lida?.toSnapshot()).toEqual(m.toSnapshot());
      expect(lida?.aporteMensal).toBeNull();
    });

    it('save insere e depois atualiza a mesma linha, inclusive atualizadoEm vindo do domínio', async () => {
      const sub = await h.criarSubscriber();
      const m = metaPorAporte(sub);
      await h.repo.save(m);
      m.atualizar({ nome: 'Viagem pro Japão', prazoMeses: 24, aporteMensal: null, acumulado: 800.5 }, minutos(30));
      await h.repo.save(m);

      const lida = await h.repo.findById(m.id, sub);
      expect(lida?.toSnapshot()).toMatchObject({
        nome: 'Viagem pro Japão',
        prazoMeses: 24,
        aporteMensal: null,
        acumulado: 800.5,
        criadoEm: agora,
        atualizadoEm: minutos(30),
      });
      expect(await h.repo.countBySubscriber(sub)).toBe(1);
    });

    it('mutar a entidade sem save não altera o que está gravado — nem a salva, nem a lida', async () => {
      const sub = await h.criarSubscriber();
      const m = metaPorAporte(sub);
      await h.repo.save(m);
      m.atualizar({ nome: 'Não salvo' }, minutos(1));

      const lida = await h.repo.findById(m.id, sub);
      expect(lida?.nome).toBe('Viagem');
      lida?.atualizar({ acumulado: 999 }, minutos(2));
      expect((await h.repo.findById(m.id, sub))?.acumulado).toBe(0);
      expect((await h.repo.listBySubscriber(sub))[0]?.nome).toBe('Viagem');
    });

    it('findById: de outra pessoa ou inexistente devolve null', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const m = metaPorAporte(a);
      await h.repo.save(m);
      expect(await h.repo.findById(m.id, a)).not.toBeNull();
      expect(await h.repo.findById(m.id, b)).toBeNull();
      expect(await h.repo.findById(novoId(), a)).toBeNull();
    });

    it('listBySubscriber: da mais recente pra mais antiga, só as da pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const antiga = metaPorAporte(a, { nome: 'Antiga', criadoEm: minutos(0) });
      const nova = metaPorAporte(a, { nome: 'Nova', criadoEm: minutos(20) });
      const meio = metaPorAporte(a, { nome: 'Meio', criadoEm: minutos(10) });
      for (const m of [antiga, nova, meio, metaPorAporte(b, { nome: 'De outra pessoa', criadoEm: minutos(15) })]) {
        await h.repo.save(m);
      }

      expect((await h.repo.listBySubscriber(a)).map((m) => m.nome)).toEqual(['Nova', 'Meio', 'Antiga']);
      expect((await h.repo.listBySubscriber(b)).map((m) => m.nome)).toEqual(['De outra pessoa']);
      expect(await h.repo.listBySubscriber(await h.criarSubscriber())).toEqual([]);
    });

    it('listBySubscriber: empate no criadoEm desempata por id, decrescente', async () => {
      const sub = await h.criarSubscriber();
      const [id1, id2, id3] = [novoId(), novoId(), novoId()];
      // gravadas fora de ordem: a ordem não pode depender da inserção
      for (const id of [id2, id3, id1]) await h.repo.save(metaPorAporte(sub, { id, criadoEm: agora }));
      expect((await h.repo.listBySubscriber(sub)).map((m) => m.id)).toEqual([id3, id2, id1]);
    });

    it('countBySubscriber conta só as da pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await h.repo.save(metaPorAporte(a));
      await h.repo.save(metaPorAporte(a));
      await h.repo.save(metaPorAporte(b));
      expect(await h.repo.countBySubscriber(a)).toBe(2);
      expect(await h.repo.countBySubscriber(b)).toBe(1);
      expect(await h.repo.countBySubscriber(await h.criarSubscriber())).toBe(0);
    });

    it('findByPublicSlug e isPublicSlugTaken acham a publicada, de qualquer dono', async () => {
      const sub = await h.criarSubscriber();
      const m = publicada(sub, 'viagem-abc123');
      await h.repo.save(m);
      await h.repo.save(metaPorAporte(sub, { nome: 'Privada' }));

      expect((await h.repo.findByPublicSlug('viagem-abc123'))?.toSnapshot()).toEqual(m.toSnapshot());
      expect(await h.repo.isPublicSlugTaken('viagem-abc123')).toBe(true);
      expect(await h.repo.findByPublicSlug('viagem-abc124')).toBeNull();
      expect(await h.repo.isPublicSlugTaken('viagem-abc124')).toBe(false);
    });

    it('slug é comparado exatamente: prefixo e maiúsculas não casam', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(publicada(sub, 'viagem-abc123'));
      expect(await h.repo.findByPublicSlug('viagem-abc12')).toBeNull();
      expect(await h.repo.findByPublicSlug('VIAGEM-ABC123')).toBeNull();
      expect(await h.repo.isPublicSlugTaken('viagem-%')).toBe(false);
    });

    it('slug público repetido → ConflictError, mesmo entre pessoas diferentes, e a segunda não é gravada', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await h.repo.save(publicada(a, 'viagem-abc123'));
      const repetida = publicada(b, 'viagem-abc123');

      await expect(h.repo.save(repetida)).rejects.toBeInstanceOf(ConflictError);
      expect(await h.repo.findById(repetida.id, b)).toBeNull();
      expect((await h.repo.findByPublicSlug('viagem-abc123'))?.subscriberId).toBe(a);
    });

    it('slug repetido numa meta que já existia → ConflictError e a gravada continua sem slug', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(publicada(sub, 'viagem-abc123'));
      const outra = metaPorAporte(sub);
      await h.repo.save(outra);

      outra.publicar('viagem-abc123', minutos(1));
      await expect(h.repo.save(outra)).rejects.toBeInstanceOf(ConflictError);
      expect((await h.repo.findById(outra.id, sub))?.publicSlug).toBeNull();
    });

    it('regravar a meta com o próprio slug não conflita consigo mesma', async () => {
      const sub = await h.criarSubscriber();
      const m = publicada(sub, 'viagem-abc123');
      await h.repo.save(m);
      m.atualizar({ acumulado: 100 }, minutos(1));
      await expect(h.repo.save(m)).resolves.toBeUndefined();
    });

    it('várias metas sem slug não colidem entre si (NULL não é repetido)', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(metaPorAporte(sub));
      await expect(h.repo.save(metaPorAporte(sub))).resolves.toBeUndefined();
    });

    it('despublicar libera o slug pra outra meta', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const primeira = publicada(a, 'viagem-abc123');
      await h.repo.save(primeira);
      primeira.despublicar(minutos(1));
      await h.repo.save(primeira);

      expect(await h.repo.isPublicSlugTaken('viagem-abc123')).toBe(false);
      expect(await h.repo.findByPublicSlug('viagem-abc123')).toBeNull();

      const segunda = publicada(b, 'viagem-abc123');
      await expect(h.repo.save(segunda)).resolves.toBeUndefined();
      expect((await h.repo.findByPublicSlug('viagem-abc123'))?.id).toBe(segunda.id);
    });

    it('delete apaga só com o dono certo; inexistente não falha; o slug fica livre', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const m = publicada(a, 'viagem-abc123');
      await h.repo.save(m);

      await h.repo.delete(m.id, b);
      expect(await h.repo.findById(m.id, a)).not.toBeNull();

      await h.repo.delete(m.id, a);
      expect(await h.repo.findById(m.id, a)).toBeNull();
      expect(await h.repo.isPublicSlugTaken('viagem-abc123')).toBe(false);

      await expect(h.repo.delete(novoId(), a)).resolves.toBeUndefined();
    });

    it('deleteAllBySubscriber apaga só as daquela pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await h.repo.save(publicada(a, 'viagem-aaa111'));
      await h.repo.save(metaPorAporte(a));
      const deB = publicada(b, 'viagem-bbb222');
      await h.repo.save(deB);

      await h.repo.deleteAllBySubscriber(a);
      expect(await h.repo.countBySubscriber(a)).toBe(0);
      expect(await h.repo.isPublicSlugTaken('viagem-aaa111')).toBe(false);
      expect((await h.repo.listBySubscriber(b)).map((m) => m.id)).toEqual([deB.id]);
      await expect(h.repo.deleteAllBySubscriber(a)).resolves.toBeUndefined();
    });
  });
}
