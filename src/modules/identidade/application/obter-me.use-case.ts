import type { UseCase } from '../../../shared/application/use-case';
import type { Subscriber } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { carregarConta } from './carregar-conta';

export interface ObterMeInput {
  subscriberId: string;
}

/** A conta de quem está autenticado. */
export class ObterMeUseCase implements UseCase<ObterMeInput, Subscriber> {
  constructor(private readonly subscribers: SubscribersRepository) {}

  execute({ subscriberId }: ObterMeInput): Promise<Subscriber> {
    return carregarConta(this.subscribers, subscriberId);
  }
}
