import type { Meta } from './meta';

export interface MetasRepository {
  /** da mais recente pra mais antiga */
  listBySubscriber(subscriberId: string): Promise<Meta[]>;
  /** null também quando a meta existe mas é de outro subscriber */
  findById(id: string, subscriberId: string): Promise<Meta | null>;
  findByPublicSlug(slug: string): Promise<Meta | null>;
  isPublicSlugTaken(slug: string): Promise<boolean>;
  countBySubscriber(subscriberId: string): Promise<number>;

  /** @throws ConflictError quando o slug público já está em uso */
  save(meta: Meta): Promise<void>;
  delete(id: string, subscriberId: string): Promise<void>;
  deleteAllBySubscriber(subscriberId: string): Promise<void>;
}
