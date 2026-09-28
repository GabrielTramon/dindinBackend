import { GastoFixo, type GastoFixoProps } from '../../domain/gasto-fixo';
import type { GastosFixosRepository } from '../../domain/gastos-fixos-repository';
import {
  categoriaInexistente,
  garantirMesmoDono,
  gastoRepetido,
  perfilInexistente,
} from './gastos-fixos-repository-errors';

/*
  Repositório em memória que se comporta como o Postgres (mesmas regras de
  categorias/infra/database/in-memory-categorias-repository.ts): guarda cópias
  profundas, emula as constraints e devolve na ordem da consulta do Prisma.

  Constraints de gastos_fixos emuladas:
  - chave primária e @@unique (profile_id, categoria_id) → ConflictError;
  - FK do perfil → BusinessRuleError; FK da categoria → NotFoundError.
  As FKs apontam pra dados de outros módulos e entram por callback, que o
  container liga. Na ordem do Postgres: unique na inserção da linha, FK no fim
  do comando. replaceAll é todo ou nada, como a transação do Prisma.

  O mesmo contrato (gastos-fixos-repository.contract.ts) roda contra esta
  classe e contra a do Prisma.
*/

export interface InMemoryGastosFixosOptions {
  /** "a pessoa tem perfil?" — padrão: sempre */
  perfilExists?: (subscriberId: string) => Promise<boolean>;
  /** "a categoria existe?" — padrão: sempre */
  categoriaExists?: (categoriaId: string) => Promise<boolean>;
}

/** o orderBy do Prisma: valor desc, criadoEm asc, id asc */
function ordem(a: GastoFixoProps, b: GastoFixoProps): number {
  return (
    b.valor - a.valor ||
    a.criadoEm.getTime() - b.criadoEm.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export class InMemoryGastosFixosRepository implements GastosFixosRepository {
  private readonly rows = new Map<string, GastoFixoProps>();
  private readonly perfilExists: (subscriberId: string) => Promise<boolean>;
  private readonly categoriaExists: (categoriaId: string) => Promise<boolean>;

  constructor(options: InMemoryGastosFixosOptions = {}) {
    this.perfilExists = options.perfilExists ?? (async () => true);
    this.categoriaExists = options.categoriaExists ?? (async () => true);
  }

  private restore(props: GastoFixoProps): GastoFixo {
    return GastoFixo.restaurar(structuredClone(props));
  }

  private doDono(subscriberId: string): GastoFixoProps[] {
    return [...this.rows.values()].filter((g) => g.subscriberId === subscriberId);
  }

  private async garantirReferencias(props: GastoFixoProps): Promise<void> {
    if (!(await this.perfilExists(props.subscriberId))) throw perfilInexistente();
    if (!(await this.categoriaExists(props.categoriaId))) throw categoriaInexistente();
  }

  async listBySubscriber(subscriberId: string): Promise<GastoFixo[]> {
    return this.doDono(subscriberId)
      .sort(ordem)
      .map((g) => this.restore(g));
  }

  async findById(id: string, subscriberId: string): Promise<GastoFixo | null> {
    const row = this.rows.get(id);
    return row && row.subscriberId === subscriberId ? this.restore(row) : null;
  }

  async countBySubscriber(subscriberId: string): Promise<number> {
    return this.doDono(subscriberId).length;
  }

  async existsInCategory(subscriberId: string, categoriaId: string, ignoreId?: string): Promise<boolean> {
    return this.doDono(subscriberId).some((g) => g.categoriaId === categoriaId && g.id !== ignoreId);
  }

  async existsForCategory(categoriaId: string): Promise<boolean> {
    return [...this.rows.values()].some((g) => g.categoriaId === categoriaId);
  }

  async save(gasto: GastoFixo): Promise<void> {
    const props = gasto.toSnapshot();
    // id de gasto de outra pessoa: no Prisma, o update escopado pelo dono não acha a linha e o insert bate na chave primária
    const existente = this.rows.get(props.id);
    const idDeOutraPessoa = existente !== undefined && existente.subscriberId !== props.subscriberId;
    const colide = [...this.rows.values()].some(
      (g) => g.id !== props.id && g.subscriberId === props.subscriberId && g.categoriaId === props.categoriaId,
    );
    if (idDeOutraPessoa || colide) throw gastoRepetido();
    await this.garantirReferencias(props);
    this.rows.set(props.id, structuredClone(props));
  }

  async delete(id: string, subscriberId: string): Promise<void> {
    // escopado: id de gasto alheio não apaga nada, e inexistente não é erro
    if (this.rows.get(id)?.subscriberId === subscriberId) this.rows.delete(id);
  }

  async replaceAll(subscriberId: string, gastos: GastoFixo[]): Promise<void> {
    const novos = gastos.map((g) => g.toSnapshot());
    garantirMesmoDono(subscriberId, novos);

    // tudo conferido antes de apagar: no Postgres, a violação desfaz o delete junto
    const ids = new Set(novos.map((g) => g.id));
    const categorias = new Set(novos.map((g) => g.categoriaId));
    // o delete só tira as linhas desta pessoa: id de gasto de outra ainda colide na chave primária
    const idDeOutraPessoa = [...this.rows.values()].some((g) => g.subscriberId !== subscriberId && ids.has(g.id));
    if (ids.size !== novos.length || categorias.size !== novos.length || idDeOutraPessoa) throw gastoRepetido();
    for (const props of novos) await this.garantirReferencias(props);

    for (const g of this.doDono(subscriberId)) this.rows.delete(g.id);
    for (const props of novos) this.rows.set(props.id, structuredClone(props));
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    for (const g of this.doDono(subscriberId)) this.rows.delete(g.id);
  }
}
