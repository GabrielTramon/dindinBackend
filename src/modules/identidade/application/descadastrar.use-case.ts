import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import type { Subscriber } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { carregarConta } from './carregar-conta';

export interface DescadastrarInput {
  subscriberId: string;
}

/** Para o e-mail mensal. Não encerra a sessão nem impede de entrar: só desliga o envio. */
export class DescadastrarUseCase implements UseCase<DescadastrarInput, Subscriber> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId }: DescadastrarInput): Promise<Subscriber> {
    const subscriber = await carregarConta(this.subscribers, subscriberId);
    // já descadastrada: nada muda, e não regravar a linha evita sobrescrever um login no meio
    if (!subscriber.ativo) return subscriber;
    subscriber.descadastrar(this.clock.now());
    await this.subscribers.save(subscriber);
    return subscriber;
  }
}
