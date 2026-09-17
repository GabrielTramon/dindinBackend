import type { UseCase } from '../../../shared/application/use-case';
import type { CarregarPerfilDoMotorUseCase, PerfilDoMotor } from './perfil-do-motor';
import { perfilNaoRespondido } from './perfil-nao-respondido';

export interface ObterPerfilCompletoInput {
  subscriberId: string;
}

/** Perfil + gastos fixos + dívidas no formato do frontend (o mesmo que o motor recebe). */
export class ObterPerfilCompletoUseCase implements UseCase<ObterPerfilCompletoInput, PerfilDoMotor> {
  constructor(private readonly carregar: CarregarPerfilDoMotorUseCase) {}

  async execute({ subscriberId }: ObterPerfilCompletoInput): Promise<PerfilDoMotor> {
    const perfil = await this.carregar.execute({ subscriberId });
    if (!perfil) throw perfilNaoRespondido();
    return perfil;
  }
}
