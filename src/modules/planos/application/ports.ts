import type { PerfilDoMotor } from '../domain/versao-plano';

/*
  O que planos precisa de fora, sem importar os módulos donos.

  O perfil completo (perfil + gastos + categorias + dívidas no formato do
  motor) é montado pelo módulo perfil; o main liga esta porta ao
  CarregarPerfilDoMotorUseCase de lá. Assim planos não depende de perfil.
*/

export interface PerfilDoMotorReader {
  /** null quando a pessoa ainda não tem perfil */
  load(subscriberId: string): Promise<PerfilDoMotor | null>;
}
