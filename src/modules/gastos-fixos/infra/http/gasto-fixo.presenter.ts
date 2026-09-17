import { arredondar } from '../../../../shared/motor/format';
import type { Categoria } from '../../../categorias';
import type { GastoFixoComCategoria } from '../../application/gasto-com-categoria';

/*
  Gasto como o cliente vê. Não expõe o dono nem o categoriaId solto: a
  categoria vai inteira, no mesmo formato de GET /categorias, pra tela não
  precisar cruzar as duas listas.
*/

function presentCategoria(categoria: Categoria) {
  return {
    id: categoria.id,
    slug: categoria.slug,
    nome: categoria.nome,
    grupo: categoria.grupo,
    icone: categoria.icone,
    personalizada: !categoria.ehDoCatalogo,
  };
}

export function presentGastoFixo({ gasto, categoria }: GastoFixoComCategoria) {
  return {
    id: gasto.id,
    valor: gasto.valor,
    criadoEm: gasto.criadoEm.toISOString(),
    categoria: presentCategoria(categoria),
  };
}

export function presentGastosFixos(itens: readonly GastoFixoComCategoria[]) {
  return {
    items: itens.map(presentGastoFixo),
    // soma em ponto flutuante deixa resto (0,1 + 0,2 = 0,30000000000000004); cada valor tem
    // no máximo 2 casas, então arredondar a soma no fim devolve o total exato
    total: arredondar(itens.reduce((soma, { gasto }) => soma + gasto.valor, 0)),
  };
}

export type GastoFixoResponse = ReturnType<typeof presentGastoFixo>;
export type GastosFixosResponse = ReturnType<typeof presentGastosFixos>;
