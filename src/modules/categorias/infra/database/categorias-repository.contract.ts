import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../../../../shared/domain/errors';
import { CATEGORIAS } from '../../../../shared/motor/categorias';
import { Categoria } from '../../domain/categoria';
import type { CategoriasRepository } from '../../domain/categorias-repository';

/*
  Contrato de CategoriasRepository: o mesmo comportamento pra qualquer
  implementação. Roda contra a versão em memória (in-memory-categorias-repository.test.ts)
  e contra a do Prisma num Postgres de verdade (*.integration.test.ts).

  Não é um arquivo .test.ts: é uma função que cada implementação chama.
*/

export interface CategoriasRepositoryHarness {
  repo: CategoriasRepository;
  /** cria um subscriber válido (no Prisma, a FK exige que ele exista) e devolve o id */
  criarSubscriber(): Promise<string>;
  /** deixa a categoria em uso: um gasto fixo apontando pra ela */
  colocarEmUso(categoriaId: string, subscriberId: string): Promise<void>;
  /** id de uma categoria do catálogo semeado */
  idDoCatalogo(slug: string): Promise<string>;
}

const agora = new Date('2026-09-17T12:00:00.000Z');
let sequencia = 0;
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

export function describeCategoriasRepositoryContract(nome: string, setup: () => Promise<CategoriasRepositoryHarness>) {
  describe(`CategoriasRepository — ${nome}`, () => {
    let h: CategoriasRepositoryHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const personalizada = (subscriberId: string, nomeCategoria: string) =>
      Categoria.criarPersonalizada({ id: novoId(), nome: nomeCategoria, subscriberId, agora });

    it('lista o catálogo semeado inteiro pra visitante, na ordem grupo → ordem', async () => {
      const lista = await h.repo.listVisible(null);
      expect(lista.map((c) => c.slug)).toEqual(CATEGORIAS.map((c) => c.slug));
      expect(lista.every((c) => c.ehDoCatalogo)).toBe(true);
    });

    it('autenticado vê o catálogo + as próprias, nunca as dos outros; personalizadas no fim (grupo outros)', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await h.repo.save(personalizada(a, 'Clube'));
      await h.repo.save(personalizada(b, 'Padaria'));

      const deA = await h.repo.listVisible(a);
      expect(deA.map((c) => c.nome)).toContain('Clube');
      expect(deA.map((c) => c.nome)).not.toContain('Padaria');
      expect(deA).toHaveLength(CATEGORIAS.length + 1);
      expect(deA.filter((c) => c.grupo === 'outros').map((c) => c.nome)).toEqual(['Outro', 'Clube']);
    });

    it('save insere e depois atualiza a mesma linha', async () => {
      const sub = await h.criarSubscriber();
      const c = personalizada(sub, 'Clube');
      await h.repo.save(c);
      c.renomear('Clube novo');
      await h.repo.save(c);

      const lida = await h.repo.findById(c.id);
      expect(lida?.nome).toBe('Clube novo');
      expect(await h.repo.countCustom(sub)).toBe(1);
    });

    it('mutar a entidade sem save não altera o que está gravado', async () => {
      const sub = await h.criarSubscriber();
      const c = personalizada(sub, 'Clube');
      await h.repo.save(c);
      c.renomear('Não salvo');
      expect((await h.repo.findById(c.id))?.nome).toBe('Clube');
    });

    it('findBySlug acha do catálogo; findById de id inexistente devolve null', async () => {
      expect((await h.repo.findBySlug('academia'))?.nome).toBe('Academia');
      expect(await h.repo.findBySlug('nao-existe')).toBeNull();
      expect(await h.repo.findById(novoId())).toBeNull();
    });

    it('findCustomByName ignora maiúsculas e só olha as da própria pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await h.repo.save(personalizada(a, 'Clube do Bairro'));
      expect((await h.repo.findCustomByName(a, 'clube do bairro'))?.nome).toBe('Clube do Bairro');
      expect(await h.repo.findCustomByName(b, 'Clube do Bairro')).toBeNull();
      // catálogo não entra nessa busca
      expect(await h.repo.findCustomByName(a, 'Mercado')).toBeNull();
    });

    it('findCustomByName trata % e _ como texto, não como curinga', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(personalizada(sub, 'Clube'));
      expect(await h.repo.findCustomByName(sub, 'C%')).toBeNull();
      expect(await h.repo.findCustomByName(sub, 'Club_')).toBeNull();
      await h.repo.save(personalizada(sub, '100% academia'));
      expect((await h.repo.findCustomByName(sub, '100% ACADEMIA'))?.nome).toBe('100% academia');
    });

    it('save com nome idêntico ao de outra personalizada da mesma dona → ConflictError', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(personalizada(sub, 'Clube'));
      await expect(h.repo.save(personalizada(sub, 'Clube'))).rejects.toBeInstanceOf(ConflictError);
    });

    it('mesmo nome em donas diferentes não colide', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await h.repo.save(personalizada(a, 'Clube'));
      await expect(h.repo.save(personalizada(b, 'Clube'))).resolves.toBeUndefined();
    });

    it('isInUse e delete: em uso → ConflictError e continua lá; sem uso → some', async () => {
      const sub = await h.criarSubscriber();
      const usada = personalizada(sub, 'Usada');
      const livre = personalizada(sub, 'Livre');
      await h.repo.save(usada);
      await h.repo.save(livre);
      await h.colocarEmUso(usada.id, sub);

      expect(await h.repo.isInUse(usada.id)).toBe(true);
      expect(await h.repo.isInUse(livre.id)).toBe(false);

      await expect(h.repo.delete(usada.id)).rejects.toBeInstanceOf(ConflictError);
      expect(await h.repo.findById(usada.id)).not.toBeNull();

      await h.repo.delete(livre.id);
      expect(await h.repo.findById(livre.id)).toBeNull();
    });

    it('delete de id inexistente não falha', async () => {
      await expect(h.repo.delete(novoId())).resolves.toBeUndefined();
    });

    it('deleteAllCustom com alguma em uso → ConflictError e nenhuma é apagada', async () => {
      const sub = await h.criarSubscriber();
      const usada = personalizada(sub, 'A1');
      await h.repo.save(usada);
      await h.repo.save(personalizada(sub, 'A2'));
      await h.colocarEmUso(usada.id, sub);

      await expect(h.repo.deleteAllCustom(sub)).rejects.toBeInstanceOf(ConflictError);
      expect(await h.repo.countCustom(sub)).toBe(2);
    });

    it('deleteAllCustom apaga só as personalizadas daquela pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await h.repo.save(personalizada(a, 'A1'));
      await h.repo.save(personalizada(a, 'A2'));
      await h.repo.save(personalizada(b, 'B1'));

      await h.repo.deleteAllCustom(a);
      expect(await h.repo.countCustom(a)).toBe(0);
      expect(await h.repo.countCustom(b)).toBe(1);
      expect(await h.repo.listVisible(null)).toHaveLength(CATEGORIAS.length);
    });
  });
}
