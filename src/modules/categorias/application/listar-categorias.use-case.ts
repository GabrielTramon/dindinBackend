import type { UseCase } from '../../../shared/application/use-case';
import type { Categoria } from '../domain/categoria';
import type { CategoriasRepository } from '../domain/categorias-repository';

export interface ListarCategoriasInput {
  /** null = visitante: só o catálogo */
  subscriberId: string | null;
}

/** O catálogo, mais as categorias que a pessoa criou quando ela está autenticada. */
export class ListarCategoriasUseCase implements UseCase<ListarCategoriasInput, Categoria[]> {
  constructor(private readonly categorias: CategoriasRepository) {}

  execute({ subscriberId }: ListarCategoriasInput): Promise<Categoria[]> {
    return this.categorias.listVisible(subscriberId);
  }
}
