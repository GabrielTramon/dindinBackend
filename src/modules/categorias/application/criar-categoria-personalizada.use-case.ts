import type { Clock, IdGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { BusinessRuleError } from '../../../shared/domain/errors';
import { Categoria, MAX_CATEGORIAS_PERSONALIZADAS, normalizarNomeCategoria } from '../domain/categoria';
import type { CategoriasRepository } from '../domain/categorias-repository';
import { garantirNomeDisponivel } from './nome-disponivel';

export interface CriarCategoriaPersonalizadaInput {
  subscriberId: string;
  nome: string;
}

/** Categoria de nome livre, com o ícone padrão e visível só pra quem criou. */
export class CriarCategoriaPersonalizadaUseCase implements UseCase<CriarCategoriaPersonalizadaInput, Categoria> {
  constructor(
    private readonly categorias: CategoriasRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId, nome }: CriarCategoriaPersonalizadaInput): Promise<Categoria> {
    const nomeNormalizado = normalizarNomeCategoria(nome);

    if ((await this.categorias.countCustom(subscriberId)) >= MAX_CATEGORIAS_PERSONALIZADAS) {
      throw new BusinessRuleError(
        `Você chegou no limite de ${MAX_CATEGORIAS_PERSONALIZADAS} categorias próprias. Exclua uma que não usa mais.`,
      );
    }
    await garantirNomeDisponivel(this.categorias, subscriberId, nomeNormalizado);

    const categoria = Categoria.criarPersonalizada({
      id: this.ids.generate(),
      nome: nomeNormalizado,
      subscriberId,
      agora: this.clock.now(),
    });
    await this.categorias.save(categoria);
    return categoria;
  }
}
