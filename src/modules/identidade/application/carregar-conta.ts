import { NotFoundError } from '../../../shared/domain/errors';
import type { Subscriber } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';

/**
 * A conta da sessão. A autenticação já confere que ela existe, mas a exclusão
 * pode acontecer entre o middleware e o caso de uso.
 * @throws NotFoundError quando não existe mais
 */
export async function carregarConta(subscribers: SubscribersRepository, subscriberId: string): Promise<Subscriber> {
  const subscriber = await subscribers.findById(subscriberId);
  if (!subscriber) throw new NotFoundError('Conta não encontrada.');
  return subscriber;
}
