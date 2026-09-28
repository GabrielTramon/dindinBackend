import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import type { Subscriber } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { carregarConta } from './carregar-conta';

export interface ReativarInput {
  subscriberId: string;
}

/** Volta a receber o e-mail mensal (se o endereço já estiver confirmado). */
export class ReativarUseCase implements UseCase<ReativarInput, Subscriber> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId }: ReativarInput): Promise<Subscriber> {
    const subscriber = await carregarConta(this.subscribers, subscriberId);
    // já ativa: nada muda, e não regravar a linha evita sobrescrever um login no meio
    if (subscriber.ativo) return subscriber;
    subscriber.reativar(this.clock.now());
    await this.subscribers.save(subscriber);
    return subscriber;
  }
}
