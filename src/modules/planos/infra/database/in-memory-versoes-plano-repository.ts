import { decodeIntCursor, encodeCursor, type Page, type PageRequest } from '../../../../shared/application/pagination';
import { ConflictError } from '../../../../shared/domain/errors';
import { VersaoPlano, type VersaoPlanoProps } from '../../domain/versao-plano';
import type { VersoesPlanoRepository } from '../../domain/versoes-plano-repository';

/*
  Repositório em memória que se comporta como o Postgres: guarda cópias
  profundas, emula a PK e a unique (subscriberId, versao) — é nela que o
  GerarPlanoUseCase percebe a corrida — e devolve na ordem da consulta Prisma.

  O mesmo contrato (versoes-plano-repository.contract.ts) roda contra esta
  classe e contra a do Prisma.
*/

export class InMemoryVersoesPlanoRepository implements VersoesPlanoRepository {
  private readonly rows = new Map<string, VersaoPlanoProps>();

  private restore(props: VersaoPlanoProps): VersaoPlano {
    return VersaoPlano.restaurar(structuredClone(props));
  }

  /** da versão mais nova pra mais antiga, como o orderBy versao desc */
  private doSubscriber(subscriberId: string): VersaoPlanoProps[] {
    return [...this.rows.values()].filter((r) => r.subscriberId === subscriberId).sort((a, b) => b.versao - a.versao);
  }

  async findLatest(subscriberId: string): Promise<VersaoPlano | null> {
    const [row] = this.doSubscriber(subscriberId);
    return row ? this.restore(row) : null;
  }

  async findByVersion(subscriberId: string, versao: number): Promise<VersaoPlano | null> {
    const row = this.doSubscriber(subscriberId).find((r) => r.versao === versao);
    return row ? this.restore(row) : null;
  }

  async findEmVigorEm(subscriberId: string, ate: Date): Promise<VersaoPlano | null> {
    const versoes = this.doSubscriber(subscriberId);
    // versao e criadoEm são monotônicos juntos: percorrendo da maior versão pra
    // menor, a primeira que já existia naquele instante é a que valia
    const vigente = versoes.find((r) => r.criadoEm.getTime() < ate.getTime());
    // sem nenhuma até lá, a mais antiga (a lista está em versão desc)
    const row = vigente ?? versoes.at(-1);
    return row ? this.restore(row) : null;
  }

  async list(subscriberId: string, page: PageRequest): Promise<Page<VersaoPlano>> {
    const antesDe = decodeIntCursor(page.cursor);
    const rows = this.doSubscriber(subscriberId).filter((r) => antesDe === undefined || r.versao < antesDe);
    const items = rows.slice(0, page.limit);
    const ultima = items.at(-1);
    return {
      items: items.map((r) => this.restore(r)),
      nextCursor: rows.length > page.limit && ultima ? encodeCursor(ultima.versao) : null,
    };
  }

  async nextVersion(subscriberId: string): Promise<number> {
    const [maior] = this.doSubscriber(subscriberId);
    return (maior?.versao ?? 0) + 1;
  }

  async save(versao: VersaoPlano): Promise<void> {
    const props = versao.toSnapshot();
    // PK (id) e @@unique([subscriberId, versao]); só insere, como o create do Prisma
    const colide =
      this.rows.has(props.id) ||
      [...this.rows.values()].some((r) => r.subscriberId === props.subscriberId && r.versao === props.versao);
    if (colide) throw new ConflictError('Essa versão do plano já foi gravada.');
    this.rows.set(props.id, structuredClone(props));
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.subscriberId === subscriberId) this.rows.delete(id);
    }
  }
}
