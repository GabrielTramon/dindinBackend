import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import type { FixedClock } from '../../../shared/infra/in-memory/doubles';
import { Categoria, type CategoriasRepository } from '../../categorias';
import type { DividasRepository } from '../../dividas';
import type { GastosFixosRepository } from '../../gastos-fixos';
import type { PerfisRepository } from '../domain/perfis-repository';
import type { ObterPerfilCompletoUseCase } from './obter-perfil-completo.use-case';
import type { PerfilDoMotor } from './perfil-do-motor';
import type { SincronizarPerfilCompletoUseCase } from './sincronizar-perfil-completo.use-case';

/*
  Bateria da sincronização do perfil completo (PUT /perfil/completo): o mesmo
  comportamento com os repositórios em memória (perfil.use-cases.test.ts) e com
  os do Prisma num Postgres de verdade (sincronizar-perfil-completo.integration.test.ts).

  Só entra aqui o que vale nos dois modos. Erro que acontece DEPOIS de gravar o
  perfil depende do rollback, que só o Postgres tem: fica no teste de integração.

  Não é um arquivo .test.ts: é uma função que cada montagem chama.
*/

export interface SincronizacaoHarness {
  sincronizar: SincronizarPerfilCompletoUseCase;
  obterCompleto: ObterPerfilCompletoUseCase;
  perfis: PerfisRepository;
  categorias: CategoriasRepository;
  gastosFixos: GastosFixosRepository;
  dividas: DividasRepository;
  /** o mesmo relógio que o caso de uso usa */
  clock: FixedClock;
  /** subscriber válido (no Prisma, a FK do perfil exige); devolve o id */
  criarSubscriber(): Promise<string>;
}

let sequencia = 0;
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

const BASE: PerfilDoMotor = {
  rendaMensal: 2800.5,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1200,
  guardado: 1000,
  gastosFixos: [],
  dividas: [],
};

const com = (mudancas: Partial<PerfilDoMotor>): PerfilDoMotor => ({ ...BASE, ...mudancas });

export function describeSincronizarPerfilCompletoContract(nome: string, setup: () => Promise<SincronizacaoHarness>) {
  describe(`SincronizarPerfilCompletoUseCase — ${nome}`, () => {
    let h: SincronizacaoHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const sincronizar = (subscriberId: string, perfil: PerfilDoMotor) => h.sincronizar.execute({ subscriberId, perfil });
    const obter = (subscriberId: string) => h.obterCompleto.execute({ subscriberId });
    const personalizadas = async (subscriberId: string) =>
      (await h.categorias.listVisible(subscriberId))
        .filter((c) => !c.ehDoCatalogo)
        .map((c) => c.nome)
        .sort();
    const criarPorFora = (subscriberId: string, nomeCategoria: string) =>
      h.categorias.save(Categoria.criarPersonalizada({ id: novoId(), nome: nomeCategoria, subscriberId, agora: h.clock.now() }));

    it('perfil novo do zero: grava escalares, gastos e dívidas e devolve o que ficou gravado', async () => {
      const sub = await h.criarSubscriber();
      const entrada = com({
        gastosFixos: [
          { categoria: 'luz', valor: 120 },
          { categoria: 'outro', nome: 'Clube', valor: 80.9 },
          { categoria: 'mercado', valor: 450.9 },
        ],
        dividas: [
          { tipo: 'emprestimo', saldo: 3000, parcela: 250, taxaAnual: 0.45 },
          { tipo: 'rotativo', saldo: 1500.1 },
          { tipo: 'outra', saldo: 99.99, parcela: 0 },
        ],
      });

      const devolvido = await sincronizar(sub, entrada);

      const esperado: PerfilDoMotor = {
        ...entrada,
        // gastos voltam do maior pro menor (ordem do repositório); dívidas, na ordem enviada
        gastosFixos: [
          { categoria: 'mercado', valor: 450.9 },
          { categoria: 'luz', valor: 120 },
          { categoria: 'outro', nome: 'Clube', valor: 80.9 },
        ],
      };
      expect(devolvido).toEqual(esperado);
      expect(await obter(sub)).toEqual(esperado);
      expect(await personalizadas(sub)).toEqual(['Clube']);
      expect((await h.perfis.findBySubscriberId(sub))?.atualizadoEm).toEqual(h.clock.now());
    });

    it('dois "outro" Clube e clube viram UMA linha somada, com o primeiro nome, e uma categoria só', async () => {
      const sub = await h.criarSubscriber();
      const devolvido = await sincronizar(
        sub,
        com({
          gastosFixos: [
            { categoria: 'outro', nome: 'Clube', valor: 100 },
            { categoria: 'outro', nome: 'clube', valor: 50.5 },
          ],
        }),
      );

      expect(devolvido.gastosFixos).toEqual([{ categoria: 'outro', nome: 'Clube', valor: 150.5 }]);
      expect(await h.gastosFixos.countBySubscriber(sub)).toBe(1);
      expect(await personalizadas(sub)).toEqual(['Clube']);
    });

    it('"outro: Condomínio" usa a categoria do catálogo e volta como { categoria: "condominio" }', async () => {
      const sub = await h.criarSubscriber();
      await sincronizar(sub, com({ gastosFixos: [{ categoria: 'outro', nome: 'Condomínio', valor: 300 }] }));

      expect((await obter(sub)).gastosFixos).toEqual([{ categoria: 'condominio', valor: 300 }]);
      expect(await personalizadas(sub)).toEqual([]);
    });

    it('slug mercado + "outro: Mercado" viram uma linha só, somada', async () => {
      const sub = await h.criarSubscriber();
      await sincronizar(
        sub,
        com({
          gastosFixos: [
            { categoria: 'mercado', valor: 400 },
            { categoria: 'outro', nome: 'Mercado', valor: 50 },
          ],
        }),
      );

      expect((await obter(sub)).gastosFixos).toEqual([{ categoria: 'mercado', valor: 450 }]);
      expect(await personalizadas(sub)).toEqual([]);
    });

    it('renomear "Clube" pra "Clube de tiro" em dois PUTs deixa uma única personalizada: a antiga sai', async () => {
      const sub = await h.criarSubscriber();
      await sincronizar(sub, com({ gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 80 }] }));
      await sincronizar(sub, com({ gastosFixos: [{ categoria: 'outro', nome: 'Clube de tiro', valor: 80 }] }));

      expect(await personalizadas(sub)).toEqual(['Clube de tiro']);
      expect((await obter(sub)).gastosFixos).toEqual([{ categoria: 'outro', nome: 'Clube de tiro', valor: 80 }]);
    });

    it('personalizada criada por fora, sem gasto, sobrevive aos PUTs', async () => {
      const sub = await h.criarSubscriber();
      await criarPorFora(sub, 'Padaria');
      await sincronizar(sub, com({ gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 80 }] }));
      expect(await personalizadas(sub)).toEqual(['Clube', 'Padaria']);

      await sincronizar(sub, com({ gastosFixos: [{ categoria: 'mercado', valor: 450 }] }));
      expect(await personalizadas(sub)).toEqual(['Padaria']);
    });

    it('personalizada que a pessoa já tem é reaproveitada pelo nome, sem duplicar', async () => {
      const sub = await h.criarSubscriber();
      await criarPorFora(sub, 'Padaria');
      const devolvido = await sincronizar(sub, com({ gastosFixos: [{ categoria: 'outro', nome: ' PADARIA ', valor: 35 }] }));

      expect(devolvido.gastosFixos).toEqual([{ categoria: 'outro', nome: 'Padaria', valor: 35 }]);
      expect(await personalizadas(sub)).toEqual(['Padaria']);
    });

    it('PUT com lista de dívidas vazia apaga as dívidas', async () => {
      const sub = await h.criarSubscriber();
      await sincronizar(sub, com({ dividas: [{ tipo: 'rotativo', saldo: 1500 }, { tipo: 'outra', saldo: 200 }] }));
      const devolvido = await sincronizar(sub, com({ dividas: [] }));

      expect(devolvido.dividas).toEqual([]);
      expect(await h.dividas.countBySubscriber(sub)).toBe(0);
    });

    it('PUT com lista de gastos vazia apaga os gastos e as personalizadas que eles usavam', async () => {
      const sub = await h.criarSubscriber();
      await sincronizar(
        sub,
        com({ gastosFixos: [{ categoria: 'mercado', valor: 450 }, { categoria: 'outro', nome: 'Clube', valor: 80 }] }),
      );
      const devolvido = await sincronizar(sub, com({ gastosFixos: [] }));

      expect(devolvido.gastosFixos).toEqual([]);
      expect(await h.gastosFixos.countBySubscriber(sub)).toBe(0);
      expect(await personalizadas(sub)).toEqual([]);
    });

    it('idempotente: o mesmo corpo duas vezes dá o mesmo GET, com os mesmos gastos e a mesma categoria', async () => {
      const sub = await h.criarSubscriber();
      // valores iguais de propósito: a ordem não pode depender de id aleatório
      const entrada = com({
        gastosFixos: [
          { categoria: 'luz', valor: 100 },
          { categoria: 'outro', nome: 'Clube', valor: 100 },
          { categoria: 'mercado', valor: 100 },
        ],
        dividas: [
          { tipo: 'rotativo', saldo: 700 },
          { tipo: 'emprestimo', saldo: 700, parcela: 90 },
          { tipo: 'outra', saldo: 700 },
        ],
      });

      const primeiro = await sincronizar(sub, entrada);
      const idsDosGastos = (await h.gastosFixos.listBySubscriber(sub)).map((g) => g.id);
      const idDoClube = (await h.categorias.findCustomByName(sub, 'Clube'))?.id;
      h.clock.advance(60_000);
      const segundo = await sincronizar(sub, entrada);

      expect(primeiro.gastosFixos).toEqual(entrada.gastosFixos);
      expect(primeiro.dividas).toEqual(entrada.dividas);
      expect(segundo).toEqual(primeiro);
      expect(await obter(sub)).toEqual(primeiro);
      expect((await h.gastosFixos.listBySubscriber(sub)).map((g) => g.id)).toEqual(idsDosGastos);
      expect((await h.categorias.findCustomByName(sub, 'Clube'))?.id).toBe(idDoClube);
    });

    it('perfil que já existe é atualizado: escalares novos, moradia sem custo zera o custo, data do relógio', async () => {
      const sub = await h.criarSubscriber();
      await sincronizar(sub, BASE);
      h.clock.advance(60_000);
      const devolvido = await sincronizar(sub, com({ rendaMensal: 4100.1, tipoRenda: 'pj', moradia: 'pais', custoMoradia: 800 }));

      expect(devolvido).toMatchObject({ rendaMensal: 4100.1, tipoRenda: 'pj', moradia: 'pais', custoMoradia: 0 });
      expect((await h.perfis.findBySubscriberId(sub))?.atualizadoEm).toEqual(h.clock.now());
    });

    it('valor inválido numa linha → ValidationError no caminho da linha enviada, e NADA é gravado', async () => {
      const sub = await h.criarSubscriber();
      await sincronizar(sub, com({ gastosFixos: [{ categoria: 'luz', valor: 120 }], dividas: [{ tipo: 'outra', saldo: 100 }] }));
      const perfilAntes = (await h.perfis.findBySubscriberId(sub))?.toSnapshot();
      const completoAntes = await obter(sub);
      h.clock.advance(60_000);

      const falha = sincronizar(
        sub,
        com({
          rendaMensal: 9000,
          gastosFixos: [
            { categoria: 'mercado', valor: 100 },
            { categoria: 'outro', nome: 'Mercado', valor: 50 },
            { categoria: 'outro', nome: 'Clube', valor: 10.005 },
          ],
          dividas: [],
        }),
      );

      // posição 2 da lista recebida, mesmo com as duas primeiras virando uma linha só
      await expect(falha).rejects.toBeInstanceOf(ValidationError);
      await expect(falha).rejects.toMatchObject({ details: { 'gastosFixos.2.valor': 'No máximo 2 casas decimais' } });
      expect((await h.perfis.findBySubscriberId(sub))?.toSnapshot()).toEqual(perfilAntes);
      expect(await obter(sub)).toEqual(completoAntes);
      expect(await personalizadas(sub)).toEqual([]);
    });

    it('dívida inválida → ValidationError em dividas.N.campo, e nada é gravado', async () => {
      const sub = await h.criarSubscriber();
      await sincronizar(sub, com({ dividas: [{ tipo: 'rotativo', saldo: 300 }] }));
      const antes = await obter(sub);

      const falha = sincronizar(
        sub,
        com({
          gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 80 }],
          dividas: [
            { tipo: 'emprestimo', saldo: 1000 },
            { tipo: 'outra', saldo: 100, taxaAnual: 0.12345 },
          ],
        }),
      );

      await expect(falha).rejects.toMatchObject({ details: { 'dividas.1.taxaAnual': 'No máximo 4 casas decimais' } });
      expect(await obter(sub)).toEqual(antes);
      expect(await personalizadas(sub)).toEqual([]);
    });

    it('resposta escalar inválida numa pessoa sem perfil → ValidationError no campo, e o perfil não nasce', async () => {
      const sub = await h.criarSubscriber();
      const falha = sincronizar(sub, com({ idade: 13, gastosFixos: [{ categoria: 'mercado', valor: 450 }] }));

      await expect(falha).rejects.toMatchObject({ details: { idade: 'A partir de 14 anos' } });
      expect(await h.perfis.exists(sub)).toBe(false);
      expect(await h.gastosFixos.countBySubscriber(sub)).toBe(0);
    });

    it('nunca mexe nos dados de outra pessoa, nem na personalizada de mesmo nome', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await sincronizar(
        a,
        com({ gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 80 }], dividas: [{ tipo: 'rotativo', saldo: 900 }] }),
      );
      const deA = await obter(a);

      await sincronizar(b, com({ idade: 40, gastosFixos: [{ categoria: 'outro', nome: 'Clube', valor: 10 }] }));
      await sincronizar(b, com({ idade: 41, gastosFixos: [{ categoria: 'outro', nome: 'Clube de tiro', valor: 10 }], dividas: [] }));

      expect(await obter(a)).toEqual(deA);
      expect(await personalizadas(a)).toEqual(['Clube']);
      expect(await personalizadas(b)).toEqual(['Clube de tiro']);
    });
  });
}
