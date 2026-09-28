import type { UseCase } from '../../../shared/application/use-case';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/domain/errors';
import type { CategoriasRepository } from '../domain/categorias-repository';

export interface ExcluirCategoriaInput {
  subscriberId: string;
  categoriaId: string;
}

export class ExcluirCategoriaUseCase implements UseCase<ExcluirCategoriaInput, void> {
  constructor(private readonly categorias: CategoriasRepository) {}

  async execute({ subscriberId, categoriaId }: ExcluirCategoriaInput): Promise<void> {
    const categoria = await this.categorias.findById(categoriaId);
    if (!categoria || !categoria.ehVisivelPara(subscriberId)) {
      throw new NotFoundError('Categoria não encontrada.');
    }
    if (categoria.ehDoCatalogo) {
      throw new BusinessRuleError('Categorias do catálogo não podem ser excluídas.');
    }
    // checagem amigável; o repositório ainda converte a violação da FK se outro pedido
    // criar um gasto nessa categoria entre esta linha e o delete
    if (await this.categorias.isInUse(categoria.id)) {
      throw new ConflictError('Essa categoria tem gastos. Remova os gastos dela antes de excluir.');
    }
    await this.categorias.delete(categoria.id);
  }
}
