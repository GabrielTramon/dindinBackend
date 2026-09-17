import type { Clock, IdGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { ConflictError } from '../../../shared/domain/errors';
import { ensure } from '../../../shared/domain/guards';
import type { VersoesPlanoRepository } from '../../planos';
import { CheckIn, competenciaValida, MENSAGEM_COMPETENCIA_INVALIDA, type RespostaCheckIn } from '../domain/check-in';
import type { CheckInsRepository } from '../domain/check-ins-repository';
import { comComparacao, type CheckInComComparacao } from './comparacao-com-plano';

/*
  A pessoa conta como foi o mês. Não precisa esperar o e-mail: se o job ainda
  não abriu o check-in dessa competência, abre aqui (CheckIn.abrir recusa mês
  futuro). Responder de novo corrige a resposta.

  Corrida com o job: o job do dia 1 pode inserir o check-in entre a nossa busca
  e o nosso insert. A unique (subscriberId, competencia) derruba o nosso insert
  com ConflictError; aí relemos o que o job gravou e respondemos em cima dele —
  uma vez só: depois do conflito a linha existe, e a segunda tentativa é um
  update. Nada disso roda em transactions.run: no Postgres, depois do erro de
  unique a transação fica abortada e a releitura falharia.
*/

export const TENTATIVAS_DE_RESPONDER = 2;

export interface ResponderCheckInInput {
  subscriberId: string;
  /** "2026-09" */
  competencia: string;
  rendaReal: number;
  gastoReal: number;
  guardadoReal: number;
}

export class ResponderCheckInUseCase implements UseCase<ResponderCheckInInput, CheckInComComparacao> {
  constructor(
    private readonly checkIns: CheckInsRepository,
    private readonly versoesPlano: VersoesPlanoRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: ResponderCheckInInput): Promise<CheckInComComparacao> {
    ensure(competenciaValida(input.competencia), 'competencia', MENSAGEM_COMPETENCIA_INVALIDA);
    // campo a campo: chave extra vinda do chamador não chega na entidade
    const resposta: RespostaCheckIn = {
      rendaReal: input.rendaReal,
      gastoReal: input.gastoReal,
      guardadoReal: input.guardadoReal,
    };
    const checkIn = await this.gravarResposta(input.subscriberId, input.competencia, resposta);
    return comComparacao(this.versoesPlano, checkIn);
  }

  private async gravarResposta(subscriberId: string, competencia: string, resposta: RespostaCheckIn): Promise<CheckIn> {
    const agora = this.clock.now();
    for (let tentativa = 1; tentativa <= TENTATIVAS_DE_RESPONDER; tentativa++) {
      const existente = await this.checkIns.findByCompetencia(subscriberId, competencia);
      const checkIn = existente ?? CheckIn.abrir({ id: this.ids.generate(), subscriberId, competencia, agora });
      // valida tudo antes de mudar qualquer campo: resposta inválida não chega no save
      checkIn.responder(resposta, agora);
      try {
        await this.checkIns.save(checkIn);
        return checkIn;
      } catch (erro) {
        // só o insert perde a corrida pro job; qualquer outro erro sobe na hora
        if (!(erro instanceof ConflictError) || existente) throw erro;
      }
    }
    throw new ConflictError('Outra resposta desse mês estava sendo gravada. Tente de novo.');
  }
}
