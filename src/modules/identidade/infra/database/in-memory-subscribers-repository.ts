import { encodeCursor, type Page, type PageRequest } from '../../../../shared/application/pagination';
import { ConflictError } from '../../../../shared/domain/errors';
import { Subscriber, type SubscriberProps } from '../../domain/subscriber';
import type { SubscribersRepository } from '../../domain/subscribers-repository';
import { clampPageLimit, decodeSubscriberCursor } from './subscribers-pagination';

/*
  Repositório em memória que se comporta como o Postgres (regras gerais em
  categorias/infra/database/in-memory-categorias-repository.ts):
  - guarda structuredClone do snapshot e devolve instâncias novas;
  - emula os dois UNIQUE da tabela (email e token), que o pedido de link depende;
  - saveMagicLinkConsumption compara e grava sem nenhum await no meio: no event loop
    do Node, nada roda entre a comparação e a escrita — é o equivalente do WHERE.

  O contrato (subscribers-repository.contract.ts) roda contra esta classe e
  contra a do Prisma.
*/

export class InMemorySubscribersRepository implements SubscribersRepository {
  private readonly rows = new Map<string, SubscriberProps>();

  private restore(props: SubscriberProps): Subscriber {
    return Subscriber.restaurar(structuredClone(props));
  }

  async findById(id: string): Promise<Subscriber | null> {
    const row = this.rows.get(id);
    return row ? this.restore(row) : null;
  }

  async findByEmail(email: string): Promise<Subscriber | null> {
    const row = [...this.rows.values()].find((s) => s.email === email);
    return row ? this.restore(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<Subscriber | null> {
    const row = [...this.rows.values()].find((s) => s.tokenHash === tokenHash);
    return row ? this.restore(row) : null;
  }

  async save(subscriber: Subscriber): Promise<void> {
    const props = subscriber.toSnapshot();
    const outros = [...this.rows.values()].filter((s) => s.id !== props.id);
    // @unique em email e em token
    if (outros.some((s) => s.email === props.email || s.tokenHash === props.tokenHash)) {
      throw new ConflictError('Já existe uma conta com esse e-mail.', { email: 'E-mail já cadastrado' });
    }
    this.rows.set(props.id, structuredClone(props));
  }

  async saveMagicLinkConsumption(subscriber: Subscriber, usedTokenHash: string): Promise<boolean> {
    const atual = this.rows.get(subscriber.id);
    if (!atual || atual.tokenHash !== usedTokenHash) return false;
    const consumido = subscriber.toSnapshot();
    // só os campos do consumo, como o SET do Prisma: ativo e e-mail da linha ficam
    this.rows.set(atual.id, {
      ...atual,
      tokenHash: consumido.tokenHash,
      tokenExpiraEm: consumido.tokenExpiraEm,
      emailVerificadoEm: consumido.emailVerificadoEm,
      atualizadoEm: consumido.atualizadoEm,
    });
    return true;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async listEmailable(page: PageRequest): Promise<Page<Subscriber>> {
    const depoisDe = decodeSubscriberCursor(page.cursor);
    const limit = clampPageLimit(page.limit);
    // comparação por unidade de código, como o ORDER BY id do Postgres. Os ids são UUID
    // (mesmo formato, hífens nas mesmas posições): qualquer collation dá a mesma ordem.
    const elegiveis = [...this.rows.values()]
      .filter((s) => s.ativo && s.emailVerificadoEm !== null)
      .filter((s) => depoisDe === undefined || s.id > depoisDe)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const items = elegiveis.slice(0, limit).map((s) => this.restore(s));
    const ultimo = items.at(-1);
    return { items, nextCursor: elegiveis.length > limit && ultimo ? encodeCursor(ultimo.id) : null };
  }
}
