import type { UseCase } from '../../../shared/application/use-case';
import type { Divida } from '../domain/divida';
import type { DividasRepository } from '../domain/dividas-repository';

export interface ListarDividasInput {
  subscriberId: string;
}

/** As dívidas da pessoa, na ordem em que foram cadastradas. */
export class ListarDividasUseCase implements UseCase<ListarDividasInput, Divida[]> {
  constructor(private readonly dividas: DividasRepository) {}

  execute({ subscriberId }: ListarDividasInput): Promise<Divida[]> {
    return this.dividas.listBySubscriber(subscriberId);
  }
}
