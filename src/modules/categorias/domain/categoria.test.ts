import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ValidationError } from '../../../shared/domain/errors';
import { Categoria, normalizarNomeCategoria } from './categoria';

const agora = new Date('2026-09-17T12:00:00.000Z');

const doCatalogo = () =>
  Categoria.restaurar({
    id: 'categoria-mercado',
    slug: 'mercado',
    nome: 'Mercado',
    grupo: 'casa',
    icone: 'ShoppingCart',
    ordem: 10,
    subscriberId: null,
    criadoEm: agora,
  });

describe('Categoria', () => {
  it('personalizada nasce no grupo outros, com ícone padrão e sem slug', () => {
    const c = Categoria.criarPersonalizada({ id: 'c1', nome: '  Clube   do  bairro ', subscriberId: 'sub-1', agora });
    expect(c.toSnapshot()).toEqual({
      id: 'c1',
      slug: null,
      nome: 'Clube do bairro',
      grupo: 'outros',
      icone: 'Tag',
      ordem: 999,
      subscriberId: 'sub-1',
      criadoEm: agora,
    });
    expect(c.ehDoCatalogo).toBe(false);
  });

  it('catálogo é visível pra todos; personalizada só pra dona', () => {
    const propria = Categoria.criarPersonalizada({ id: 'c1', nome: 'Clube', subscriberId: 'sub-1', agora });
    expect(doCatalogo().ehVisivelPara(null)).toBe(true);
    expect(doCatalogo().ehVisivelPara('qualquer')).toBe(true);
    expect(propria.ehVisivelPara('sub-1')).toBe(true);
    expect(propria.ehVisivelPara('sub-2')).toBe(false);
    expect(propria.ehVisivelPara(null)).toBe(false);
  });

  it('renomeia personalizada', () => {
    const c = Categoria.criarPersonalizada({ id: 'c1', nome: 'Clube', subscriberId: 'sub-1', agora });
    c.renomear(' Clube novo ');
    expect(c.nome).toBe('Clube novo');
  });

  it('não renomeia categoria do catálogo', () => {
    expect(() => doCatalogo().renomear('Supermercado')).toThrow(BusinessRuleError);
  });

  it.each([
    ['', 'Dê um nome pra categoria'],
    ['    ', 'Dê um nome pra categoria'],
    ['x'.repeat(41), 'No máximo 40 caracteres'],
  ])('nome inválido %j', (nome, mensagem) => {
    try {
      normalizarNomeCategoria(nome);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toEqual({ nome: mensagem });
    }
  });

  it('toSnapshot devolve cópia: mexer nela não altera a entidade', () => {
    const c = Categoria.criarPersonalizada({ id: 'c1', nome: 'Clube', subscriberId: 'sub-1', agora });
    const snap = c.toSnapshot() as { nome: string };
    snap.nome = 'Outro';
    expect(c.nome).toBe('Clube');
  });
});
