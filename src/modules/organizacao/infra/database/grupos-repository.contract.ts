import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../../../../shared/domain/errors';
import { Grupo, type ItemGrupoInput } from '../../domain/grupo';
import type { GruposRepository } from '../../domain/grupos-repository';

/*
  Contrato de GruposRepository: o mesmo comportamento pra qualquer
  implementação. Roda contra a versão em memória (in-memory-grupos-repository.test.ts)
  e contra a do Prisma num Postgres de verdade (*.integration.test.ts).

  Não é um arquivo .test.ts: é uma função que cada implementação chama.

  O que NÃO está aqui: a corrida de dois replaceAll simultâneos. PGlite é uma
  sessão só e não reproduz — a garantia é o FOR NO KEY UPDATE documentado no
  PrismaGruposRepository.
*/

export interface GruposRepositoryHarness {
  repo: GruposRepository;
  /** cria um subscriber válido (no Prisma, a FK exige que ele exista) e devolve o id */
  criarSubscriber(): Promise<string>;
}

const agora = new Date('2026-09-18T12:00:00.000Z');
let sequencia = 0;
// ids em ordem crescente e com o mesmo formato: ordem de texto igual no Postgres e no JS
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

export function describeGruposRepositoryContract(nome: string, setup: () => Promise<GruposRepositoryHarness>) {
  describe(`GruposRepository — ${nome}`, () => {
    let h: GruposRepositoryHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const grupo = (
      subscriberId: string,
      ordem: number,
      opcoes: {
        id?: string;
        nome?: string;
        icone?: string;
        valor?: number;
        contaParaMeta?: boolean;
        rendimentoMensal?: number;
        doSistema?: boolean;
        itens?: ItemGrupoInput[];
      } = {},
    ) =>
      Grupo.criar({
        id: opcoes.id ?? novoId(),
        subscriberId,
        nome: opcoes.nome ?? `Grupo ${ordem}`,
        icone: opcoes.icone,
        valor: opcoes.valor ?? 500,
        contaParaMeta: opcoes.contaParaMeta,
        rendimentoMensal: opcoes.rendimentoMensal,
        doSistema: opcoes.doSistema,
        ordem,
        itens: opcoes.itens,
        agora,
      });

    const snapshots = (grupos: Grupo[]) => grupos.map((g) => g.toSnapshot());

    it('árvore nunca gravada devolve lista vazia, não erro', async () => {
      const sub = await h.criarSubscriber();
      expect(await h.repo.listBySubscriber(sub)).toEqual([]);
      expect(await h.repo.countBySubscriber(sub)).toBe(0);
    });

    it('round-trip: a árvore inteira volta idêntica, com centavos, rendimento e itens', async () => {
      const sub = await h.criarSubscriber();
      const arvore = [
        grupo(sub, 0, {
          nome: 'Guardar',
          icone: 'PiggyBank',
          valor: 840.55,
          doSistema: true,
        }),
        grupo(sub, 1, {
          nome: 'Investimento',
          icone: 'TrendingUp',
          valor: 800,
          contaParaMeta: true,
          rendimentoMensal: 0.0085,
          itens: [
            { id: novoId(), nome: 'Viagem', valor: 300 },
            { id: novoId(), nome: 'Presente', valor: 19.99 },
          ],
        }),
      ];
      await h.repo.replaceAll(sub, arvore);

      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots(arvore));
      expect(await h.repo.countBySubscriber(sub)).toBe(2);
    });

    it('grupo sem rendimento volta SEM a chave — coluna nula não vira null no domínio', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.replaceAll(sub, [grupo(sub, 0)]);

      const [lido] = await h.repo.listBySubscriber(sub);
      expect(lido!.rendimentoMensal).toBeUndefined();
      expect('rendimentoMensal' in lido!.toSnapshot()).toBe(false);
    });

    it('a ordem é posicional: volta na ordem gravada, não na alfabética nem na de id', async () => {
      const sub = await h.criarSubscriber();
      const [id1, id2, id3] = [novoId(), novoId(), novoId()];
      const arvore = [
        grupo(sub, 0, { id: id3, nome: 'Zebra' }),
        grupo(sub, 1, { id: id1, nome: 'Abacate' }),
        grupo(sub, 2, { id: id2, nome: 'Manga' }),
      ];
      await h.repo.replaceAll(sub, arvore);

      expect((await h.repo.listBySubscriber(sub)).map((g) => g.nome)).toEqual(['Zebra', 'Abacate', 'Manga']);
    });

    it('a ordem dos itens dentro do grupo também é a gravada', async () => {
      const sub = await h.criarSubscriber();
      const itens = [
        { id: `z-${novoId()}`, nome: 'Último na ordem de id', valor: 10 },
        { id: `a-${novoId()}`, nome: 'Primeiro na ordem de id', valor: 10 },
      ];
      await h.repo.replaceAll(sub, [grupo(sub, 0, { itens })]);

      const [lido] = await h.repo.listBySubscriber(sub);
      expect(lido!.itens.map((i) => i.nome)).toEqual(['Último na ordem de id', 'Primeiro na ordem de id']);
    });

    it('replaceAll substitui a árvore inteira: o que não veio some, inclusive os itens', async () => {
      const sub = await h.criarSubscriber();
      const antigoId = novoId();
      await h.repo.replaceAll(sub, [
        grupo(sub, 0, { id: antigoId, nome: 'Antigo', itens: [{ id: novoId(), nome: 'Item velho', valor: 5 }] }),
        grupo(sub, 1, { nome: 'Também antigo' }),
      ]);

      // o MESMO id volta com outro conteúdo: é assim que a pessoa edita um grupo
      const novos = [grupo(sub, 0, { id: antigoId, nome: 'Renomeado', valor: 123.45 })];
      await h.repo.replaceAll(sub, novos);

      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots(novos));
    });

    it('replaceAll com lista vazia apaga a árvore da pessoa', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.replaceAll(sub, [grupo(sub, 0, { itens: [{ id: novoId(), nome: 'Item', valor: 5 }] })]);

      await h.repo.replaceAll(sub, []);
      expect(await h.repo.listBySubscriber(sub)).toEqual([]);
    });

    it('replaceAll não toca a árvore de outra pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const deB = [grupo(b, 0, { nome: 'Da B', itens: [{ id: novoId(), nome: 'Item da B', valor: 7 }] })];
      await h.repo.replaceAll(a, [grupo(a, 0, { nome: 'Da A' })]);
      await h.repo.replaceAll(b, deB);

      await h.repo.replaceAll(a, []);

      expect(await h.repo.listBySubscriber(a)).toEqual([]);
      expect(snapshots(await h.repo.listBySubscriber(b))).toEqual(snapshots(deB));
    });

    it('o mesmo id em duas pessoas é legal: a chave primária leva o dono junto', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const id = novoId();
      const itemId = novoId();
      await h.repo.replaceAll(a, [grupo(a, 0, { id, nome: 'Da A', itens: [{ id: itemId, nome: 'Item', valor: 1 }] })]);
      await h.repo.replaceAll(b, [grupo(b, 0, { id, nome: 'Da B', itens: [{ id: itemId, nome: 'Item', valor: 2 }] })]);

      expect((await h.repo.listBySubscriber(a))[0]!.nome).toBe('Da A');
      expect((await h.repo.listBySubscriber(b))[0]!.nome).toBe('Da B');
    });

    it('replaceAll com dois grupos do mesmo id → ConflictError e a árvore anterior continua', async () => {
      const sub = await h.criarSubscriber();
      const anterior = [grupo(sub, 0, { nome: 'Anterior' })];
      await h.repo.replaceAll(sub, anterior);

      const id = novoId();
      await expect(
        h.repo.replaceAll(sub, [grupo(sub, 0, { id }), grupo(sub, 1, { id })]),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots(anterior));
    });

    it('replaceAll com dois itens do mesmo id no grupo → ConflictError e nada é gravado', async () => {
      const sub = await h.criarSubscriber();
      const anterior = [grupo(sub, 0, { nome: 'Anterior' })];
      await h.repo.replaceAll(sub, anterior);

      // a entidade não deixa chegar aqui: este é o caso de quem usa o repositório direto
      const itemId = novoId();
      const comItensIguais = Grupo.restaurar({
        ...grupo(sub, 0).toSnapshot(),
        itens: [
          { id: itemId, nome: 'Um', valor: 1, ordem: 0 },
          { id: itemId, nome: 'Outro', valor: 2, ordem: 1 },
        ],
      });

      await expect(h.repo.replaceAll(sub, [comItensIguais])).rejects.toBeInstanceOf(ConflictError);
      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots(anterior));
    });

    it('mutar a entidade depois do replaceAll não altera o que está gravado', async () => {
      const sub = await h.criarSubscriber();
      const g = grupo(sub, 0, { itens: [{ id: novoId(), nome: 'Item', valor: 10 }] });
      await h.repo.replaceAll(sub, [g]);

      const props = g.toSnapshot();
      props.nome = 'Não salvo';
      props.itens[0]!.valor = 999;

      const [lido] = await h.repo.listBySubscriber(sub);
      expect(lido!.nome).toBe(g.nome);
      expect(lido!.itens[0]!.valor).toBe(10);
    });

    it('deleteAllBySubscriber apaga grupos e itens só daquela pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const deB = [grupo(b, 0, { itens: [{ id: novoId(), nome: 'Item da B', valor: 3 }] })];
      await h.repo.replaceAll(a, [
        grupo(a, 0, { itens: [{ id: novoId(), nome: 'Item da A', valor: 3 }] }),
        grupo(a, 1),
      ]);
      await h.repo.replaceAll(b, deB);

      await h.repo.deleteAllBySubscriber(a);

      expect(await h.repo.countBySubscriber(a)).toBe(0);
      expect(snapshots(await h.repo.listBySubscriber(b))).toEqual(snapshots(deB));
    });

    it('deleteAllBySubscriber de quem nunca organizou nada não falha', async () => {
      const sub = await h.criarSubscriber();
      await expect(h.repo.deleteAllBySubscriber(sub)).resolves.toBeUndefined();
    });
  });
}
