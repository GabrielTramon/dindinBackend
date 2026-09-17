import type { TransactionManager } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { ValidationError } from '../../../shared/domain/errors';
import type { CategoriasRepository } from '../../categorias';
import type { CheckInsRepository } from '../../check-ins';
import type { DividasRepository } from '../../dividas';
import type { GastosFixosRepository } from '../../gastos-fixos';
import type { SubscribersRepository } from '../../identidade';
import type { MetasRepository } from '../../metas';
import type { PerfisRepository } from '../../perfil';
import type { VersoesPlanoRepository } from '../../planos';

/** O que a pessoa digita pra confirmar. Excluir não tem volta: um clique perdido não pode bastar. */
export const CONFIRMACAO_EXCLUSAO = 'EXCLUIR';

export const MENSAGEM_CONFIRMACAO_EXCLUSAO = `Digite ${CONFIRMACAO_EXCLUSAO} pra confirmar`;

export interface ExcluirContaInput {
  subscriberId: string;
  /** precisa ser exatamente CONFIRMACAO_EXCLUSAO */
  confirmacao: string;
}

/*
  Exclusão da conta (LGPD): física, não flag, e tudo ou nada.

  Cada módulo apaga o que é dele, numa transação só, na ordem das FKs:
    gastos fixos → dívidas → perfil → categorias personalizadas → planos → metas → check-ins → subscriber

  - gastos antes das categorias: gastos_fixos.categoria_id é Restrict, e um gasto
    numa categoria personalizada barraria a exclusão dela;
  - gastos e dívidas antes do perfil: apontam pra ele (profile_id);
  - o subscriber por último: é a raiz de todas as FKs.

  Por que não confiar no ON DELETE CASCADE de subscribers: o modo em memória não
  tem cascade, e a ordem explícita faz os dois modos se comportarem igual — o que
  os testes de um provam vale pro outro.

  Nada é capturado dentro do `run`: no Postgres, depois de um erro a transação fica
  abortada e o erro precisa subir pra desfazer tudo.

  Idempotente: sem conta (excluída por outro aparelho no meio do pedido), não há
  o que apagar e o resultado é o mesmo. Depois da exclusão a sessão deixa de valer:
  o requireAuth pergunta ao SessionAccounts se a conta existe, e o main liga isso
  ao subscribers.findById.
*/
export class ExcluirContaUseCase implements UseCase<ExcluirContaInput, void> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly perfis: PerfisRepository,
    private readonly gastosFixos: GastosFixosRepository,
    private readonly dividas: DividasRepository,
    private readonly categorias: CategoriasRepository,
    private readonly versoesPlano: VersoesPlanoRepository,
    private readonly metas: MetasRepository,
    private readonly checkIns: CheckInsRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async execute({ subscriberId, confirmacao }: ExcluirContaInput): Promise<void> {
    if (confirmacao !== CONFIRMACAO_EXCLUSAO) {
      throw new ValidationError(`Pra excluir a conta e todos os seus dados, digite ${CONFIRMACAO_EXCLUSAO}.`, {
        confirmacao: MENSAGEM_CONFIRMACAO_EXCLUSAO,
      });
    }

    await this.transactions.run(async () => {
      await this.gastosFixos.deleteAllBySubscriber(subscriberId);
      await this.dividas.deleteAllBySubscriber(subscriberId);
      await this.perfis.delete(subscriberId);
      await this.categorias.deleteAllCustom(subscriberId);
      await this.versoesPlano.deleteAllBySubscriber(subscriberId);
      await this.metas.deleteAllBySubscriber(subscriberId);
      await this.checkIns.deleteAllBySubscriber(subscriberId);
      await this.subscribers.delete(subscriberId);
    });
  }
}
