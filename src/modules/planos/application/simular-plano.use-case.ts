import type { UseCase } from '../../../shared/application/use-case';
import { gerarPlano } from '../../../shared/motor/motor';
import type { PerfilDoMotor, PlanoDoMotor } from '../domain/versao-plano';

export interface SimularPlanoInput {
  /** já validado com o perfilSchema do motor */
  perfil: PerfilDoMotor;
}

/**
 * "E se eu ganhasse mais / quitasse o cartão?" — roda o motor com um perfil
 * qualquer e devolve o plano, sem gravar nada e sem precisar de conta.
 */
export class SimularPlanoUseCase implements UseCase<SimularPlanoInput, PlanoDoMotor> {
  async execute({ perfil }: SimularPlanoInput): Promise<PlanoDoMotor> {
    // cópia: o plano devolve o perfil dentro dele e ninguém deve compartilhar referência com a entrada
    return gerarPlano(structuredClone(perfil));
  }
}
