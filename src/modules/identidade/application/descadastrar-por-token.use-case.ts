import type { AuthTokenService, Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { UnauthorizedError } from '../../../shared/domain/errors';
import type { SubscribersRepository } from '../domain/subscribers-repository';

export interface DescadastrarPorTokenInput {
  /** token assinado do link no rodapé do e-mail mensal */
  token: string;
}

/**
 * Descadastro em um clique, sem entrar na conta. Idempotente: clicar de novo, ou
 * clicar depois de excluir a conta, termina igual — sem erro e sem confirmar nada.
 */
export class DescadastrarPorTokenUseCase implements UseCase<DescadastrarPorTokenInput, void> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly authTokens: AuthTokenService,
    private readonly clock: Clock,
  ) {}

  async execute({ token }: DescadastrarPorTokenInput): Promise<void> {
    // só aceita token de descadastro: um de sessão (outra audience) também é recusado
    const alvo = this.authTokens.verifyUnsubscribe(token);
    if (!alvo) throw new UnauthorizedError('Link de descadastro inválido.');

    const subscriber = await this.subscribers.findById(alvo.subscriberId);
    if (!subscriber || !subscriber.ativo) return;
    subscriber.descadastrar(this.clock.now());
    await this.subscribers.save(subscriber);
  }
}
