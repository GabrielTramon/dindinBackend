import { ConflictError } from '../../../../shared/domain/errors';
import { CATEGORIAS } from '../../../../shared/motor/categorias';
import { Categoria, ORDEM_DOS_GRUPOS, type CategoriaProps } from '../../domain/categoria';
import type { CategoriasRepository } from '../../domain/categorias-repository';

/*
  Repositório em memória que se comporta como o Postgres.

  Regras que todo repositório em memória do projeto segue:
  - guarda CÓPIAS profundas (structuredClone do snapshot), nunca a instância recebida: mutar uma entidade
    sem chamar save não pode alterar o "banco";
  - emula as constraints que o caso de uso depende (unique, FK Restrict);
  - devolve na mesma ordem que a consulta do Prisma.

  O mesmo conjunto de testes de contrato (categorias-repository.contract.ts)
  roda contra esta classe e contra a do Prisma.
*/

export interface InMemoryCategoriasOptions {
  /** semeia o catálogo do motor, como a migration faz */
  withCatalog?: boolean;
  /** "há gasto nesta categoria?" — o container liga no repositório de gastos */
  isInUse?: (categoriaId: string) => Promise<boolean>;
}

const posicaoDoGrupo = (grupo: CategoriaProps['grupo']) => ORDEM_DOS_GRUPOS.indexOf(grupo);

export class InMemoryCategoriasRepository implements CategoriasRepository {
  private readonly rows = new Map<string, CategoriaProps>();
  private readonly isInUseHook: (categoriaId: string) => Promise<boolean>;

  constructor(options: InMemoryCategoriasOptions = {}) {
    this.isInUseHook = options.isInUse ?? (async () => false);
    if (options.withCatalog) this.seedCatalog();
  }

  /** ids previsíveis: "categoria-mercado" */
  static catalogId(slug: string): string {
    return `categoria-${slug}`;
  }

  private seedCatalog(): void {
    const ordemNoGrupo = new Map<string, number>();
    for (const c of CATEGORIAS) {
      const ordem = (ordemNoGrupo.get(c.grupo) ?? 0) + 10;
      ordemNoGrupo.set(c.grupo, ordem);
      const id = InMemoryCategoriasRepository.catalogId(c.slug);
      this.rows.set(id, {
        id,
        slug: c.slug,
        nome: c.nome,
        grupo: c.grupo,
        icone: c.icone,
        ordem,
        subscriberId: null,
        criadoEm: new Date('2026-09-11T00:00:00.000Z'),
      });
    }
  }

  private restore(props: CategoriaProps): Categoria {
    return Categoria.restaurar(structuredClone(props));
  }

  async listVisible(subscriberId: string | null): Promise<Categoria[]> {
    return [...this.rows.values()]
      .filter((c) => c.subscriberId === null || (subscriberId !== null && c.subscriberId === subscriberId))
      .sort(
        (a, b) =>
          posicaoDoGrupo(a.grupo) - posicaoDoGrupo(b.grupo) ||
          a.ordem - b.ordem ||
          a.nome.localeCompare(b.nome, 'pt-BR'),
      )
      .map((c) => this.restore(c));
  }

  async findById(id: string): Promise<Categoria | null> {
    const row = this.rows.get(id);
    return row ? this.restore(row) : null;
  }

  async findBySlug(slug: string): Promise<Categoria | null> {
    const row = [...this.rows.values()].find((c) => c.slug === slug);
    return row ? this.restore(row) : null;
  }

  async findCustomByName(subscriberId: string, nome: string): Promise<Categoria | null> {
    const chave = nome.toLocaleLowerCase('pt-BR');
    const row = [...this.rows.values()].find(
      (c) => c.subscriberId === subscriberId && c.nome.toLocaleLowerCase('pt-BR') === chave,
    );
    return row ? this.restore(row) : null;
  }

  async countCustom(subscriberId: string): Promise<number> {
    return [...this.rows.values()].filter((c) => c.subscriberId === subscriberId).length;
  }

  isInUse(id: string): Promise<boolean> {
    return this.isInUseHook(id);
  }

  async save(categoria: Categoria): Promise<void> {
    const props = categoria.toSnapshot();
    // @@unique([subscriberId, nome]) — no Postgres, NULL não colide: só vale entre personalizadas
    const colide =
      props.subscriberId !== null &&
      [...this.rows.values()].some((c) => c.id !== props.id && c.subscriberId === props.subscriberId && c.nome === props.nome);
    if (colide) throw new ConflictError('Você já tem uma categoria com esse nome.', { nome: 'Nome já usado' });
    this.rows.set(props.id, structuredClone(props));
  }

  async delete(id: string): Promise<void> {
    if (!this.rows.has(id)) return;
    // onDelete: Restrict
    if (await this.isInUseHook(id)) {
      throw new ConflictError('Essa categoria tem gastos. Remova os gastos dela antes de excluir.');
    }
    this.rows.delete(id);
  }

  async deleteAllCustom(subscriberId: string): Promise<void> {
    const ids = [...this.rows.values()].filter((c) => c.subscriberId === subscriberId).map((c) => c.id);
    // onDelete: Restrict — no Postgres é um DELETE só: se uma falha, nenhuma sai
    for (const id of ids) {
      if (await this.isInUseHook(id)) {
        throw new ConflictError('Essa categoria tem gastos. Remova os gastos dela antes de excluir.');
      }
    }
    for (const id of ids) this.rows.delete(id);
  }
}
