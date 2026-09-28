/*
  O que gastos-fixos precisa de outros módulos, sem importá-los.

  O perfil é dono dos gastos (FK profile_id), mas o módulo perfil também
  depende de gastos-fixos (a sincronização do perfil completo). Pra não criar
  ciclo, esta porta pertence a gastos-fixos e o main liga ela ao PerfisRepository.
*/

export interface PerfilGateway {
  exists(subscriberId: string): Promise<boolean>;
}
