import type { Categoria } from '../../domain/categoria';

/**
 * Categoria como o cliente vê. Não expõe dono nem ordem interna: a lista já
 * vem ordenada, e `personalizada` basta pra tela decidir se mostra editar/excluir.
 */
export function presentCategoria(categoria: Categoria) {
  return {
    id: categoria.id,
    slug: categoria.slug,
    nome: categoria.nome,
    grupo: categoria.grupo,
    icone: categoria.icone,
    personalizada: !categoria.ehDoCatalogo,
  };
}

export type CategoriaResponse = ReturnType<typeof presentCategoria>;
