import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import { ensure } from '../../../shared/domain/guards';
import type { VersoesPlanoRepository } from '../../planos';
import { competenciaValida, MENSAGEM_COMPETENCIA_INVALIDA } from '../domain/check-in';
import type { CheckInsRepository } from '../domain/check-ins-repository';
import { comComparacao, type CheckInComComparacao } from './comparacao-com-plano';

export interface ObterCheckInInput {
  subscriberId: string;
  /** "2026-09" */
  competencia: string;
}

/** Um mês, com a comparação com o plano atual. De outra pessoa responde igual a inexistente. */
export class ObterCheckInUseCase implements UseCase<ObterCheckInInput, CheckInComComparacao> {
  constructor(
    private readonly checkIns: CheckInsRepository,
    private readonly versoesPlano: VersoesPlanoRepository,
  ) {}

  async execute({ subscriberId, competencia }: ObterCheckInInput): Promise<CheckInComComparacao> {
    ensure(competenciaValida(competencia), 'competencia', MENSAGEM_COMPETENCIA_INVALIDA);
    // a busca já é pelo dono: o setembro de outra pessoa simplesmente não é encontrado
    const checkIn = await this.checkIns.findByCompetencia(subscriberId, competencia);
    if (!checkIn) throw new NotFoundError('Você ainda não tem check-in desse mês.');
    return comComparacao(this.versoesPlano, checkIn);
  }
}
