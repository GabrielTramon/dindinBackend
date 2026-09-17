import type { Perfil } from '../domain/perfil';
import type { PerfisRepository } from '../domain/perfis-repository';

/*
  Criar-ou-atualizar, usado pelo PUT /perfil e pela sincronização do perfil
  completo. Quem chama já validou os dados montando `novo` com Perfil.criar:
  se a pessoa ainda não tem perfil, é ele que vai pro banco; se já tem, os
  dados validados são aplicados no existente, campo a campo, com a data nova.
*/

export interface PerfilGravado {
  perfil: Perfil;
  criado: boolean;
}

export async function gravarPerfil(perfis: PerfisRepository, novo: Perfil): Promise<PerfilGravado> {
  const existente = await perfis.findBySubscriberId(novo.subscriberId);
  if (existente) existente.atualizar(novo.toDados(), novo.atualizadoEm);
  const perfil = existente ?? novo;
  await perfis.save(perfil);
  return { perfil, criado: existente === null };
}
