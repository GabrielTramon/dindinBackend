import type { UseCase } from '../../../shared/application/use-case';
import type { CategoriasRepository } from '../../categorias';
import type { GastosFixosRepository } from '../domain/gastos-fixos-repository';
import { categoriaAusente, type GastoFixoComCategoria } from './gasto-com-categoria';

export interface ListarGastosFixosInput {
  subscriberId: string;
}

/** Os gastos da pessoa, do maior pro menor, cada um com a sua categoria. */
export class ListarGastosFixosUseCase implements UseCase<ListarGastosFixosInput, GastoFixoComCategoria[]> {
  constructor(
    private readonly gastosFixos: GastosFixosRepository,
    private readonly categorias: CategoriasRepository,
  ) {}

  async execute({ subscriberId }: ListarGastosFixosInput): Promise<GastoFixoComCategoria[]> {
    // duas consultas no total, não uma por gasto: as visíveis cobrem catálogo + personalizadas da pessoa
    const [gastos, categorias] = await Promise.all([
      this.gastosFixos.listBySubscriber(subscriberId),
      this.categorias.listVisible(subscriberId),
    ]);
    const porId = new Map(categorias.map((c) => [c.id, c]));
    return gastos.map((gasto) => {
      const categoria = porId.get(gasto.categoriaId);
      if (!categoria) throw categoriaAusente(gasto);
      return { gasto, categoria };
    });
  }
}
