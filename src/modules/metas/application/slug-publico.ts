import type { IdGenerator } from '../../../shared/application/ports';

/*
  Endereço público de uma meta: /meta/viagem-pro-japao-k3x9q2.

  A parte legível vem do nome (sem acento, minúsculas, hífens); o sufixo
  aleatório faz duas "Viagem" de pessoas diferentes não brigarem pelo mesmo
  endereço e impede adivinhar a meta de alguém só pelo nome. O sufixo sai do
  IdGenerator (UUID em produção) em vez de Math.random: nos testes fica
  previsível.

  O resultado sempre passa na regra de Meta.publicar: base de 1 a 40
  caracteres começando e terminando em [a-z0-9], "-", 6 de sufixo (8 a 47 no total).
*/

export const TAMANHO_MAXIMO_BASE_SLUG = 40;
export const TAMANHO_SUFIXO_SLUG = 6;
/** quantos sufixos sortear antes de desistir; com 36⁶ combinações, a terceira colisão seguida é bug */
export const TENTATIVAS_DE_SLUG = 3;

/** "  Viagem pro Japão!! " → "viagem-pro-japao"; nome sem letra nem número vira "meta". */
export function baseDoSlug(nome: string): string {
  const base = nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAMANHO_MAXIMO_BASE_SLUG)
    // o corte pode cair logo depois de um hífen: "…-" + "-sufixo" daria "--"
    .replace(/-+$/, '');
  return base.length > 0 ? base : 'meta';
}

/** 6 caracteres [a-z0-9] tirados dos ids gerados, sem os hífens. */
export function sufixoDoSlug(ids: IdGenerator): string {
  let fonte = '';
  // um UUID já dá 32 caracteres; ids curtos (os dos testes, "id-7") precisam de mais de uma chamada
  for (let chamadas = 0; chamadas < 10 && fonte.length < TAMANHO_SUFIXO_SLUG; chamadas++) {
    fonte += ids.generate().toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  if (fonte.length < TAMANHO_SUFIXO_SLUG) {
    throw new Error('O gerador de ids não devolve caracteres [a-z0-9] suficientes pro sufixo do endereço público.');
  }
  return fonte.slice(-TAMANHO_SUFIXO_SLUG);
}

export function gerarSlugPublico(nome: string, ids: IdGenerator): string {
  return `${baseDoSlug(nome)}-${sufixoDoSlug(ids)}`;
}
