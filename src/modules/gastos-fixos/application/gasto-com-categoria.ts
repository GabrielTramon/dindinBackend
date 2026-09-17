import type { Categoria, CategoriasRepository } from '../../categorias';
import type { GastoFixo } from '../domain/gasto-fixo';

/*
  O gasto sozinho só conhece o id da categoria; a tela precisa do nome e do
  ícone. Todo caso de uso que devolve gasto devolve os dois juntos.
*/

export interface GastoFixoComCategoria {
  gasto: GastoFixo;
  categoria: Categoria;
}

/** Defeito, não entrada inválida: a FK garante a categoria de um gasto gravado. */
export function categoriaAusente(gasto: GastoFixo): Error {
  return new Error(`Categoria ${gasto.categoriaId} do gasto ${gasto.id} não encontrada`);
}

export async function carregarCategoriaDoGasto(categorias: CategoriasRepository, gasto: GastoFixo): Promise<Categoria> {
  const categoria = await categorias.findById(gasto.categoriaId);
  if (!categoria) throw categoriaAusente(gasto);
  return categoria;
}
