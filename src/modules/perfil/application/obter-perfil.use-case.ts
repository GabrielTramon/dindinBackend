import type { UseCase } from '../../../shared/application/use-case';
import type { Perfil } from '../domain/perfil';
import type { PerfisRepository } from '../domain/perfis-repository';
import { perfilNaoRespondido } from './perfil-nao-respondido';

export interface ObterPerfilInput {
  subscriberId: string;
}

/** As respostas escalares do onboarding, sem gastos nem dívidas. */
export class ObterPerfilUseCase implements UseCase<ObterPerfilInput, Perfil> {
  constructor(private readonly perfis: PerfisRepository) {}

  async execute({ subscriberId }: ObterPerfilInput): Promise<Perfil> {
    const perfil = await this.perfis.findBySubscriberId(subscriberId);
    if (!perfil) throw perfilNaoRespondido();
    return perfil;
  }
}
