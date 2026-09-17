import type { Page, PageRequest } from '../../../shared/application/pagination';
import type { VersaoPlano } from './versao-plano';

export interface VersoesPlanoRepository {
  findLatest(subscriberId: string): Promise<VersaoPlano | null>;
  findByVersion(subscriberId: string, versao: number): Promise<VersaoPlano | null>;
  /** da versão mais nova pra mais antiga */
  list(subscriberId: string, page: PageRequest): Promise<Page<VersaoPlano>>;
  /** maior versão + 1, ou 1 quando não há nenhuma */
  nextVersion(subscriberId: string): Promise<number>;

  /** @throws ConflictError quando a versão já existe (dois recálculos ao mesmo tempo) */
  save(versao: VersaoPlano): Promise<void>;
  deleteAllBySubscriber(subscriberId: string): Promise<void>;
}
