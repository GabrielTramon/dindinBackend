import { ConflictError } from '../../../../shared/domain/errors';
import { Meta, type MetaProps } from '../../domain/meta';
import type { MetasRepository } from '../../domain/metas-repository';

/*
  Repositório em memória que se comporta como o Postgres:
  - guarda cópias profundas (structuredClone do snapshot) e devolve instâncias novas;
  - emula o unique de public_slug (NULL não colide, como no Postgres);
  - ordena igual à consulta do Prisma: criadoEm desc, id desc.

  O mesmo contrato (metas-repository.contract.ts) roda contra esta classe e contra a do Prisma.
*/

/**
 * Comparação por unidade de código, igual ao ORDER BY de texto com collation C.
 * Os ids de produção são UUIDs (hex minúsculo com hífens nas mesmas posições),
 * que ordenam do mesmo jeito em qualquer collation.
 */
const compararTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class InMemoryMetasRepository implements MetasRepository {
  private readonly rows = new Map<string, MetaProps>();

  private restore(props: MetaProps): Meta {
    return Meta.restaurar(structuredClone(props));
  }

  async listBySubscriber(subscriberId: string): Promise<Meta[]> {
    return [...this.rows.values()]
      .filter((m) => m.subscriberId === subscriberId)
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime() || compararTexto(b.id, a.id))
      .map((m) => this.restore(m));
  }

  async findById(id: string, subscriberId: string): Promise<Meta | null> {
    const row = this.rows.get(id);
    return row && row.subscriberId === subscriberId ? this.restore(row) : null;
  }

  async findByPublicSlug(slug: string): Promise<Meta | null> {
    const row = [...this.rows.values()].find((m) => m.publicSlug === slug);
    return row ? this.restore(row) : null;
  }

  async isPublicSlugTaken(slug: string): Promise<boolean> {
    return [...this.rows.values()].some((m) => m.publicSlug === slug);
  }

  async countBySubscriber(subscriberId: string): Promise<number> {
    return [...this.rows.values()].filter((m) => m.subscriberId === subscriberId).length;
  }

  async save(meta: Meta): Promise<void> {
    const props = meta.toSnapshot();
    // @unique em public_slug
    const colide =
      props.publicSlug !== null &&
      [...this.rows.values()].some((m) => m.id !== props.id && m.publicSlug === props.publicSlug);
    if (colide) throw new ConflictError('Esse endereço público já está em uso.', { publicSlug: 'Endereço já usado' });
    this.rows.set(props.id, structuredClone(props));
  }

  async delete(id: string, subscriberId: string): Promise<void> {
    if (this.rows.get(id)?.subscriberId === subscriberId) this.rows.delete(id);
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    for (const [id, m] of this.rows) {
      if (m.subscriberId === subscriberId) this.rows.delete(id);
    }
  }
}
