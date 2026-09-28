import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { VersaoPlano } from '../domain/versao-plano';
import type { VersoesPlanoRepository } from '../domain/versoes-plano-repository';

export interface ObterVersaoPlanoInput {
  subscriberId: string;
  versao: number;
}

/** Uma versão específica do histórico. De outra pessoa responde igual a inexistente. */
export class ObterVersaoPlanoUseCase implements UseCase<ObterVersaoPlanoInput, VersaoPlano> {
  constructor(private readonly versoesPlano: VersoesPlanoRepository) {}

  async execute({ subscriberId, versao }: ObterVersaoPlanoInput): Promise<VersaoPlano> {
    // a busca já é pelo dono: a versão 3 de outra pessoa simplesmente não é encontrada
    const encontrada = await this.versoesPlano.findByVersion(subscriberId, versao);
    if (!encontrada) throw new NotFoundError('Versão do plano não encontrada.');
    return encontrada;
  }
}
