import { BusinessRuleError, ConflictError } from '../../../../shared/domain/errors';
import { Divida, type DividaProps } from '../../domain/divida';
import type { DividasRepository } from '../../domain/dividas-repository';

/*
  Repositório em memória que se comporta como o Postgres.

  - guarda CÓPIAS profundas (structuredClone do snapshot): mutar a entidade sem
    save não altera o "banco";
  - emula as constraints: FK profile_id (perfil precisa existir) e a chave
    primária (um id de outra pessoa nunca é sobrescrito), inclusive no replaceAll,
    que é todas ou nenhuma;
  - devolve na mesma ordem da consulta do Prisma.

  O mesmo contrato (dividas-repository.contract.ts) roda contra esta classe e
  contra a do Prisma.
*/

export interface InMemoryDividasOptions {
  /** "o perfil existe?" — emula a FK profile_id; o container liga no repositório de perfis */
  perfilExists?: (subscriberId: string) => Promise<boolean>;
}

const SEM_PERFIL = 'Crie seu perfil antes de adicionar dívidas.';
const ID_EM_USO = 'Não deu pra salvar a dívida. Recarregue a página e tente de novo.';

/*
  criadoEm, depois id. Comparação por unidade de código, como a collation C: os ids
  do banco são UUID em minúsculas, em que qualquer collation dá a mesma ordem.
*/
function porCriacao(a: DividaProps, b: DividaProps): number {
  return a.criadoEm.getTime() - b.criadoEm.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export class InMemoryDividasRepository implements DividasRepository {
  private readonly rows = new Map<string, DividaProps>();
  private readonly perfilExists: (subscriberId: string) => Promise<boolean>;

  constructor(options: InMemoryDividasOptions = {}) {
    this.perfilExists = options.perfilExists ?? (async () => true);
  }

  private restore(props: DividaProps): Divida {
    return Divida.restaurar(structuredClone(props));
  }

  private doSubscriber(subscriberId: string): DividaProps[] {
    return [...this.rows.values()].filter((d) => d.subscriberId === subscriberId);
  }

  async listBySubscriber(subscriberId: string): Promise<Divida[]> {
    return this.doSubscriber(subscriberId)
      .sort(porCriacao)
      .map((d) => this.restore(d));
  }

  async findById(id: string, subscriberId: string): Promise<Divida | null> {
    const row = this.rows.get(id);
    return row && row.subscriberId === subscriberId ? this.restore(row) : null;
  }

  async countBySubscriber(subscriberId: string): Promise<number> {
    return this.doSubscriber(subscriberId).length;
  }

  async save(divida: Divida): Promise<void> {
    const props = divida.toSnapshot();
    const existente = this.rows.get(props.id);
    // o Prisma atualiza filtrando pelo dono; id de outra pessoa cai no INSERT e bate na chave primária
    if (existente && existente.subscriberId !== props.subscriberId) throw new ConflictError(ID_EM_USO);
    // a FK só é conferida no INSERT: a linha existente já aponta pra um perfil válido
    if (!existente && !(await this.perfilExists(props.subscriberId))) throw new BusinessRuleError(SEM_PERFIL);
    this.rows.set(props.id, structuredClone(props));
  }

  async delete(id: string, subscriberId: string): Promise<void> {
    if (this.rows.get(id)?.subscriberId === subscriberId) this.rows.delete(id);
  }

  async replaceAll(subscriberId: string, dividas: Divida[]): Promise<void> {
    const novas = dividas.map((d) => d.toSnapshot());
    if (novas.some((d) => d.subscriberId !== subscriberId)) {
      throw new Error(`replaceAll(${subscriberId}) recebeu dívida de outro subscriber`);
    }

    // no Postgres é DELETE + INSERT numa transação: confere tudo antes de mexer em qualquer linha
    const ids = new Set<string>();
    for (const d of novas) {
      const existente = this.rows.get(d.id);
      if (ids.has(d.id) || (existente && existente.subscriberId !== subscriberId)) throw new ConflictError(ID_EM_USO);
      ids.add(d.id);
    }
    if (novas.length > 0 && !(await this.perfilExists(subscriberId))) throw new BusinessRuleError(SEM_PERFIL);

    for (const d of this.doSubscriber(subscriberId)) this.rows.delete(d.id);
    for (const d of novas) this.rows.set(d.id, structuredClone(d));
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    for (const d of this.doSubscriber(subscriberId)) this.rows.delete(d.id);
  }
}
