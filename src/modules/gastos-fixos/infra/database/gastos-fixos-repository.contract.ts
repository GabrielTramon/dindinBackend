import { beforeEach, describe, expect, it } from 'vitest';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../../shared/domain/errors';
import { GastoFixo } from '../../domain/gasto-fixo';
import type { GastosFixosRepository } from '../../domain/gastos-fixos-repository';

/*
  Contrato de GastosFixosRepository: o mesmo comportamento pra qualquer
  implementação. Roda contra a versão em memória (in-memory-gastos-fixos-repository.test.ts)
  e contra a do Prisma num Postgres de verdade (*.integration.test.ts).

  Não é um arquivo .test.ts: é uma função que cada implementação chama.
*/

export interface GastosFixosRepositoryHarness {
  repo: GastosFixosRepository;
  /** subscriber com perfil (a FK do gasto aponta pro perfil); devolve o subscriberId */
  criarPerfil(): Promise<string>;
  /** subscriber que ainda não criou o perfil */
  criarSubscriberSemPerfil(): Promise<string>;
  /** id de uma categoria do catálogo semeado */
  idDoCatalogo(slug: string): Promise<string>;
  /** categoria personalizada da pessoa; devolve o id */
  criarCategoriaPersonalizada(subscriberId: string, nome: string): Promise<string>;
}

const agora = new Date('2026-09-17T12:00:00.000Z');
const segundosDepois = (s: number) => new Date(agora.getTime() + s * 1000);
let sequencia = 0;
// ids em ordem crescente de criação e com o mesmo formato: ordem de texto igual no Postgres e no JS
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

export function describeGastosFixosRepositoryContract(nome: string, setup: () => Promise<GastosFixosRepositoryHarness>) {
  describe(`GastosFixosRepository — ${nome}`, () => {
    let h: GastosFixosRepositoryHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const gasto = (
      subscriberId: string,
      categoriaId: string,
      valor: number,
      opcoes: { id?: string; criadoEm?: Date } = {},
    ) => GastoFixo.criar({ id: opcoes.id ?? novoId(), subscriberId, categoriaId, valor, agora: opcoes.criadoEm ?? agora });

    const snapshots = (gastos: GastoFixo[]) => gastos.map((g) => g.toSnapshot());

    it('save insere e findById devolve o mesmo gasto, com centavos e data intactos', async () => {
      const sub = await h.criarPerfil();
      const mercado = gasto(sub, await h.idDoCatalogo('mercado'), 19.99, { criadoEm: segundosDepois(0.123) });
      const aluguel = gasto(sub, await h.idDoCatalogo('aluguel'), 999_999.99);
      await h.repo.save(mercado);
      await h.repo.save(aluguel);

      expect((await h.repo.findById(mercado.id, sub))?.toSnapshot()).toEqual(mercado.toSnapshot());
      expect((await h.repo.findById(aluguel.id, sub))?.toSnapshot()).toEqual(aluguel.toSnapshot());
    });

    it('save de novo atualiza a mesma linha', async () => {
      const sub = await h.criarPerfil();
      const g = gasto(sub, await h.idDoCatalogo('mercado'), 450);
      await h.repo.save(g);
      g.alterarValor(0.07);
      await h.repo.save(g);

      expect((await h.repo.findById(g.id, sub))?.valor).toBe(0.07);
      expect(await h.repo.countBySubscriber(sub)).toBe(1);
    });

    it('mutar a entidade sem save não altera o que está gravado', async () => {
      const sub = await h.criarPerfil();
      const g = gasto(sub, await h.idDoCatalogo('mercado'), 450);
      await h.repo.save(g);
      g.alterarValor(1);

      expect((await h.repo.findById(g.id, sub))?.valor).toBe(450);
    });

    it('findById de gasto de outra pessoa ou inexistente devolve null', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const g = gasto(a, await h.idDoCatalogo('mercado'), 450);
      await h.repo.save(g);

      expect(await h.repo.findById(g.id, b)).toBeNull();
      expect(await h.repo.findById(novoId(), a)).toBeNull();
    });

    it('listBySubscriber: maior valor primeiro; empate pela data de criação, depois pelo id', async () => {
      const sub = await h.criarPerfil();
      const [id1, id2, id3, id4] = [novoId(), novoId(), novoId(), novoId()];
      const maisAntigoDeIdMaior = gasto(sub, await h.idDoCatalogo('aluguel'), 100, { id: id4, criadoEm: segundosDepois(1) });
      const maisAntigoDeIdMenor = gasto(sub, await h.idDoCatalogo('mercado'), 100, { id: id2, criadoEm: segundosDepois(1) });
      const maisNovo = gasto(sub, await h.idDoCatalogo('luz'), 100, { id: id1, criadoEm: segundosDepois(2) });
      const maior = gasto(sub, await h.idDoCatalogo('agua'), 1500, { id: id3, criadoEm: segundosDepois(3) });
      const menor = gasto(sub, await h.idDoCatalogo('internet'), 0.5);
      // gravados fora da ordem esperada: a ordem tem que vir da consulta, não da inserção
      for (const g of [maisNovo, maisAntigoDeIdMaior, menor, maisAntigoDeIdMenor, maior]) await h.repo.save(g);

      expect((await h.repo.listBySubscriber(sub)).map((g) => g.id)).toEqual([
        maior.id,
        maisAntigoDeIdMenor.id,
        maisAntigoDeIdMaior.id,
        maisNovo.id,
        menor.id,
      ]);
    });

    it('gasto de outra pessoa nunca aparece em listBySubscriber nem em countBySubscriber', async () => {
      const [a, b, semGastos] = [await h.criarPerfil(), await h.criarPerfil(), await h.criarPerfil()];
      const mercado = await h.idDoCatalogo('mercado');
      const deA = [gasto(a, mercado, 300), gasto(a, await h.idDoCatalogo('luz'), 80)];
      const deB = gasto(b, mercado, 500);
      for (const g of [...deA, deB]) await h.repo.save(g);

      expect(snapshots(await h.repo.listBySubscriber(a))).toEqual(snapshots(deA));
      expect(snapshots(await h.repo.listBySubscriber(b))).toEqual(snapshots([deB]));
      expect(await h.repo.countBySubscriber(a)).toBe(2);
      expect(await h.repo.countBySubscriber(b)).toBe(1);
      expect(await h.repo.listBySubscriber(semGastos)).toEqual([]);
      expect(await h.repo.countBySubscriber(semGastos)).toBe(0);
    });

    it('gasto em categoria personalizada da pessoa grava e aparece na lista', async () => {
      const sub = await h.criarPerfil();
      const g = gasto(sub, await h.criarCategoriaPersonalizada(sub, 'Clube'), 89.9);
      await h.repo.save(g);

      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots([g]));
    });

    it('segundo gasto da mesma pessoa na mesma categoria → ConflictError e o primeiro continua', async () => {
      const sub = await h.criarPerfil();
      const mercado = await h.idDoCatalogo('mercado');
      const primeiro = gasto(sub, mercado, 450);
      await h.repo.save(primeiro);

      await expect(h.repo.save(gasto(sub, mercado, 600))).rejects.toBeInstanceOf(ConflictError);
      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots([primeiro]));
    });

    it('save com o id de um gasto de outra pessoa → ConflictError: não troca o dono em silêncio', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const deA = gasto(a, await h.idDoCatalogo('mercado'), 450);
      await h.repo.save(deA);

      const invasor = gasto(b, await h.idDoCatalogo('luz'), 1, { id: deA.id });
      await expect(h.repo.save(invasor)).rejects.toBeInstanceOf(ConflictError);
      expect((await h.repo.findById(deA.id, a))?.toSnapshot()).toEqual(deA.toSnapshot());
      expect(await h.repo.findById(deA.id, b)).toBeNull();
    });

    it('mesma categoria em pessoas diferentes não colide', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const mercado = await h.idDoCatalogo('mercado');
      await h.repo.save(gasto(a, mercado, 450));
      await expect(h.repo.save(gasto(b, mercado, 450))).resolves.toBeUndefined();
    });

    it('sem perfil → BusinessRuleError e nada é gravado', async () => {
      const sub = await h.criarSubscriberSemPerfil();
      const g = gasto(sub, await h.idDoCatalogo('mercado'), 450);

      await expect(h.repo.save(g)).rejects.toThrow(new BusinessRuleError('Crie seu perfil antes de adicionar gastos.'));
      expect(await h.repo.countBySubscriber(sub)).toBe(0);
    });

    it('categoria inexistente → NotFoundError e nada é gravado', async () => {
      const sub = await h.criarPerfil();

      await expect(h.repo.save(gasto(sub, novoId(), 450))).rejects.toBeInstanceOf(NotFoundError);
      expect(await h.repo.countBySubscriber(sub)).toBe(0);
    });

    it('existsInCategory olha só a própria pessoa; ignoreId desconsidera aquele gasto', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const mercado = await h.idDoCatalogo('mercado');
      const g = gasto(a, mercado, 450);
      await h.repo.save(g);

      expect(await h.repo.existsInCategory(a, mercado)).toBe(true);
      expect(await h.repo.existsInCategory(a, await h.idDoCatalogo('luz'))).toBe(false);
      expect(await h.repo.existsInCategory(b, mercado)).toBe(false);
      expect(await h.repo.existsInCategory(a, mercado, g.id)).toBe(false);
      expect(await h.repo.existsInCategory(a, mercado, novoId())).toBe(true);
    });

    it('existsForCategory enxerga gasto de qualquer pessoa e deixa de valer quando o último sai', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const academia = await h.idDoCatalogo('academia');
      const clube = await h.criarCategoriaPersonalizada(a, 'Clube');
      expect(await h.repo.existsForCategory(academia)).toBe(false);

      const deA = gasto(a, academia, 120);
      const deB = gasto(b, academia, 99.9);
      await h.repo.save(deA);
      await h.repo.save(deB);
      await h.repo.save(gasto(a, clube, 50));
      expect(await h.repo.existsForCategory(academia)).toBe(true);
      expect(await h.repo.existsForCategory(clube)).toBe(true);

      await h.repo.delete(deA.id, a);
      expect(await h.repo.existsForCategory(academia)).toBe(true);
      await h.repo.delete(deB.id, b);
      expect(await h.repo.existsForCategory(academia)).toBe(false);
    });

    it('delete é escopado pelo dono e idempotente', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const g = gasto(a, await h.idDoCatalogo('mercado'), 450);
      await h.repo.save(g);

      await expect(h.repo.delete(g.id, b)).resolves.toBeUndefined();
      expect(await h.repo.findById(g.id, a)).not.toBeNull();

      await h.repo.delete(g.id, a);
      expect(await h.repo.findById(g.id, a)).toBeNull();
      await expect(h.repo.delete(g.id, a)).resolves.toBeUndefined();
      await expect(h.repo.delete(novoId(), a)).resolves.toBeUndefined();
    });

    it('replaceAll troca a lista inteira, inclusive regravando uma categoria que já estava lá', async () => {
      const sub = await h.criarPerfil();
      const mercado = await h.idDoCatalogo('mercado');
      const antigos = [gasto(sub, mercado, 100), gasto(sub, await h.idDoCatalogo('luz'), 50)];
      for (const g of antigos) await h.repo.save(g);

      const novos = [gasto(sub, await h.idDoCatalogo('agua'), 30), gasto(sub, mercado, 300)];
      await h.repo.replaceAll(sub, novos);

      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots([novos[1]!, novos[0]!]));
      for (const g of antigos) expect(await h.repo.findById(g.id, sub)).toBeNull();
    });

    it('replaceAll com lista vazia apaga tudo da pessoa', async () => {
      const sub = await h.criarPerfil();
      await h.repo.save(gasto(sub, await h.idDoCatalogo('mercado'), 100));

      await h.repo.replaceAll(sub, []);
      expect(await h.repo.countBySubscriber(sub)).toBe(0);
    });

    it('replaceAll não toca a lista de outra pessoa', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const mercado = await h.idDoCatalogo('mercado');
      const deB = [gasto(b, mercado, 700), gasto(b, await h.idDoCatalogo('luz'), 90)];
      await h.repo.save(gasto(a, mercado, 100));
      for (const g of deB) await h.repo.save(g);

      await h.repo.replaceAll(a, [gasto(a, await h.idDoCatalogo('agua'), 30)]);
      await h.repo.replaceAll(a, []);

      expect(snapshots(await h.repo.listBySubscriber(b))).toEqual(snapshots(deB));
    });

    it('replaceAll com o id de um gasto de outra pessoa → ConflictError e nenhuma das duas listas muda', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const deA = gasto(a, await h.idDoCatalogo('luz'), 80);
      const deB = gasto(b, await h.idDoCatalogo('mercado'), 300);
      await h.repo.save(deA);
      await h.repo.save(deB);

      await expect(
        h.repo.replaceAll(a, [gasto(a, await h.idDoCatalogo('agua'), 10, { id: deB.id })]),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(snapshots(await h.repo.listBySubscriber(a))).toEqual(snapshots([deA]));
      expect(snapshots(await h.repo.listBySubscriber(b))).toEqual(snapshots([deB]));
    });

    it('replaceAll grava ids e datas recebidos; com valor e data iguais, a ordem sai pelo id', async () => {
      const sub = await h.criarPerfil();
      const [id1, id2, id3] = [novoId(), novoId(), novoId()];
      const lista = [
        gasto(sub, await h.idDoCatalogo('mercado'), 200, { id: id3 }),
        gasto(sub, await h.idDoCatalogo('luz'), 200, { id: id1 }),
        gasto(sub, await h.idDoCatalogo('agua'), 200, { id: id2 }),
      ];
      await h.repo.replaceAll(sub, lista);

      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots([lista[1]!, lista[2]!, lista[0]!]));
    });

    it('replaceAll com a mesma categoria duas vezes → ConflictError e a lista anterior continua', async () => {
      const sub = await h.criarPerfil();
      const mercado = await h.idDoCatalogo('mercado');
      const anterior = gasto(sub, await h.idDoCatalogo('luz'), 80);
      await h.repo.save(anterior);

      await expect(h.repo.replaceAll(sub, [gasto(sub, mercado, 100), gasto(sub, mercado, 200)])).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots([anterior]));
    });

    it('replaceAll com categoria inexistente → NotFoundError e a lista anterior continua', async () => {
      const sub = await h.criarPerfil();
      const anterior = gasto(sub, await h.idDoCatalogo('luz'), 80);
      await h.repo.save(anterior);

      await expect(
        h.repo.replaceAll(sub, [gasto(sub, await h.idDoCatalogo('mercado'), 100), gasto(sub, novoId(), 200)]),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(snapshots(await h.repo.listBySubscriber(sub))).toEqual(snapshots([anterior]));
    });

    it('replaceAll sem perfil → BusinessRuleError; com lista vazia não há o que gravar e não falha', async () => {
      const sub = await h.criarSubscriberSemPerfil();
      const mercado = await h.idDoCatalogo('mercado');

      await expect(h.repo.replaceAll(sub, [gasto(sub, mercado, 100)])).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(h.repo.replaceAll(sub, [])).resolves.toBeUndefined();
      expect(await h.repo.countBySubscriber(sub)).toBe(0);
    });

    it('replaceAll com gasto de outro dono falha sem gravar nada: não troca o dono em silêncio', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const anterior = gasto(a, await h.idDoCatalogo('luz'), 80);
      await h.repo.save(anterior);

      await expect(h.repo.replaceAll(a, [gasto(b, await h.idDoCatalogo('mercado'), 100)])).rejects.toThrow(
        'de outro perfil',
      );
      expect(snapshots(await h.repo.listBySubscriber(a))).toEqual(snapshots([anterior]));
      expect(await h.repo.countBySubscriber(b)).toBe(0);
    });

    it('deleteAllBySubscriber apaga só os gastos daquela pessoa', async () => {
      const [a, b] = [await h.criarPerfil(), await h.criarPerfil()];
      const mercado = await h.idDoCatalogo('mercado');
      await h.repo.save(gasto(a, mercado, 100));
      await h.repo.save(gasto(a, await h.idDoCatalogo('luz'), 50));
      const deB = gasto(b, mercado, 300);
      await h.repo.save(deB);

      await h.repo.deleteAllBySubscriber(a);
      expect(await h.repo.countBySubscriber(a)).toBe(0);
      expect(snapshots(await h.repo.listBySubscriber(b))).toEqual(snapshots([deB]));
    });
  });
}
