import type { Perfil } from './perfil';

export interface PerfisRepository {
  findBySubscriberId(subscriberId: string): Promise<Perfil | null>;
  /** insere ou atualiza (um perfil por subscriber) */
  save(perfil: Perfil): Promise<void>;
  delete(subscriberId: string): Promise<void>;
}
