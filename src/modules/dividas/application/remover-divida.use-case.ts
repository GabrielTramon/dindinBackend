import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { DividasRepository } from '../domain/dividas-repository';

export interface RemoverDividaInput {
  subscriberId: string;
  dividaId: string;
}

export class RemoverDividaUseCase implements UseCase<RemoverDividaInput, void> {
  constructor(private readonly dividas: DividasRepository) {}

  async execute({ subscriberId, dividaId }: RemoverDividaInput): Promise<void> {
    const divida = await this.dividas.findById(dividaId, subscriberId);
    if (!divida) throw new NotFoundError('Dívida não encontrada.');
    // o delete também filtra pelo dono: a garantia não depende só da busca acima
    await this.dividas.delete(divida.id, subscriberId);
  }
}
