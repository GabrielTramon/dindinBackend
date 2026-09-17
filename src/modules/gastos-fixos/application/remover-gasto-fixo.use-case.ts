import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { GastosFixosRepository } from '../domain/gastos-fixos-repository';

export interface RemoverGastoFixoInput {
  subscriberId: string;
  gastoId: string;
}

export class RemoverGastoFixoUseCase implements UseCase<RemoverGastoFixoInput, void> {
  constructor(private readonly gastosFixos: GastosFixosRepository) {}

  async execute({ subscriberId, gastoId }: RemoverGastoFixoInput): Promise<void> {
    // o delete do repositório é idempotente; a busca existe pra responder 404 a id alheio ou inexistente
    const gasto = await this.gastosFixos.findById(gastoId, subscriberId);
    if (!gasto) throw new NotFoundError('Gasto não encontrado.');
    await this.gastosFixos.delete(gasto.id, subscriberId);
  }
}
