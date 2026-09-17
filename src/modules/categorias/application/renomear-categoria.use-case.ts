import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import { normalizarNomeCategoria, type Categoria } from '../domain/categoria';
import type { CategoriasRepository } from '../domain/categorias-repository';
import { garantirNomeDisponivel } from './nome-disponivel';

export interface RenomearCategoriaInput {
  subscriberId: string;
  categoriaId: string;
  nome: string;
}

export class RenomearCategoriaUseCase implements UseCase<RenomearCategoriaInput, Categoria> {
  constructor(private readonly categorias: CategoriasRepository) {}

  async execute({ subscriberId, categoriaId, nome }: RenomearCategoriaInput): Promise<Categoria> {
    const categoria = await this.categorias.findById(categoriaId);
    // de outra pessoa responde igual a inexistente: não confirma que o id existe
    if (!categoria || !categoria.ehVisivelPara(subscriberId)) {
      throw new NotFoundError('Categoria não encontrada.');
    }

    const nomeNormalizado = normalizarNomeCategoria(nome);
    // só checa o nome de personalizada; catálogo cai direto no BusinessRuleError do renomear
    if (!categoria.ehDoCatalogo) {
      await garantirNomeDisponivel(this.categorias, subscriberId, nomeNormalizado, categoria.id);
    }
    categoria.renomear(nomeNormalizado);

    await this.categorias.save(categoria);
    return categoria;
  }
}
