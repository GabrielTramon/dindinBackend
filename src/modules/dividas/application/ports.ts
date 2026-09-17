/*
  Mesma porta de gastos-fixos: dívida pertence a um perfil (FK profile_id),
  e o módulo perfil depende de dividas. A porta evita o ciclo; o main liga.
*/

export interface PerfilGateway {
  exists(subscriberId: string): Promise<boolean>;
}
