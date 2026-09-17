import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { VersaoPlano } from '../domain/versao-plano';
import type { VersoesPlanoRepository } from '../domain/versoes-plano-repository';

export interface ObterPlanoAtualInput {
  subscriberId: string;
}

/** A versão mais nova do plano da pessoa. */
export class ObterPlanoAtualUseCase implements UseCase<ObterPlanoAtualInput, VersaoPlano> {
  constructor(private readonly versoesPlano: VersoesPlanoRepository) {}

  async execute({ subscriberId }: ObterPlanoAtualInput): Promise<VersaoPlano> {
    const atual = await this.versoesPlano.findLatest(subscriberId);
    if (!atual) throw new NotFoundError('Você ainda não gerou um plano.');
    return atual;
  }
}
