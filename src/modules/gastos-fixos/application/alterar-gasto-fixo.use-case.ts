import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { CategoriasRepository } from '../../categorias';
import type { GastosFixosRepository } from '../domain/gastos-fixos-repository';
import { carregarCategoriaDoGasto, type GastoFixoComCategoria } from './gasto-com-categoria';

export interface AlterarGastoFixoInput {
  subscriberId: string;
  gastoId: string;
  valor: number;
}

/** Só o valor. Trocar a categoria é remover e adicionar: é outra linha, com outro unique. */
export class AlterarGastoFixoUseCase implements UseCase<AlterarGastoFixoInput, GastoFixoComCategoria> {
  constructor(
    private readonly gastosFixos: GastosFixosRepository,
    private readonly categorias: CategoriasRepository,
  ) {}

  async execute({ subscriberId, gastoId, valor }: AlterarGastoFixoInput): Promise<GastoFixoComCategoria> {
    // de outra pessoa o repositório devolve null: responde igual a inexistente
    const gasto = await this.gastosFixos.findById(gastoId, subscriberId);
    if (!gasto) throw new NotFoundError('Gasto não encontrado.');

    // carrega antes de mexer no gasto: nada muda se a leitura falhar
    const categoria = await carregarCategoriaDoGasto(this.categorias, gasto);
    gasto.alterarValor(valor);

    await this.gastosFixos.save(gasto);
    return { gasto, categoria };
  }
}
