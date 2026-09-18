import type { UseCase } from '../../../shared/application/use-case';
import type { Grupo } from '../domain/grupo';
import type { GruposRepository } from '../domain/grupos-repository';

export interface ObterOrganizacaoInput {
  subscriberId: string;
}

/**
 * A árvore de grupos da pessoa.
 *
 * Quem nunca organizou nada recebe lista vazia, não 404: a organização é uma
 * propriedade da conta, como o perfil vazio do onboarding — e o cliente precisa
 * distinguir "ainda não organizei" de "não existo".
 */
export class ObterOrganizacaoUseCase implements UseCase<ObterOrganizacaoInput, Grupo[]> {
  constructor(private readonly grupos: GruposRepository) {}

  execute({ subscriberId }: ObterOrganizacaoInput): Promise<Grupo[]> {
    return this.grupos.listBySubscriber(subscriberId);
  }
}
