import type { Page } from '../../../shared/application/pagination';
import type { UseCase } from '../../../shared/application/use-case';
import type { VersaoPlano } from '../domain/versao-plano';
import type { VersoesPlanoRepository } from '../domain/versoes-plano-repository';

export interface ListarVersoesPlanoInput {
  subscriberId: string;
  limit: number;
  /** opaco; ilegível vira ValidationError no repositório */
  cursor?: string | null;
}

/** O histórico do plano, da versão mais nova pra mais antiga. */
export class ListarVersoesPlanoUseCase implements UseCase<ListarVersoesPlanoInput, Page<VersaoPlano>> {
  constructor(private readonly versoesPlano: VersoesPlanoRepository) {}

  execute({ subscriberId, limit, cursor }: ListarVersoesPlanoInput): Promise<Page<VersaoPlano>> {
    return this.versoesPlano.list(subscriberId, { limit, cursor });
  }
}
