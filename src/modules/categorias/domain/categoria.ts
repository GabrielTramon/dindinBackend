import { BusinessRuleError } from '../../../shared/domain/errors';
import { ensure, normalizeName } from '../../../shared/domain/guards';
import { ICONE_PADRAO, type GrupoCategoria } from '../../../shared/motor/categorias';

/*
  Categoria de gasto fixo. Duas origens na mesma entidade:

  - do catálogo: veio da migration, tem slug, subscriberId nulo, ícone próprio.
    É de todo mundo e ninguém altera.
  - personalizada: criada pela pessoa, sem slug, grupo "outros", ícone padrão.
    Só a dona vê e altera.
*/

export type { GrupoCategoria };

export const TAMANHO_MAXIMO_NOME = 40;
export const MAX_CATEGORIAS_PERSONALIZADAS = 50;

/** Ordem dos grupos na tela — a mesma do enum do Postgres e do catálogo do motor. */
export const ORDEM_DOS_GRUPOS: readonly GrupoCategoria[] = [
  'moradia',
  'casa',
  'transporte',
  'saude',
  'educacao',
  'pessoal',
  'outros',
];

export interface CategoriaProps {
  id: string;
  slug: string | null;
  nome: string;
  grupo: GrupoCategoria;
  icone: string;
  ordem: number;
  subscriberId: string | null;
  criadoEm: Date;
}

export function normalizarNomeCategoria(nome: string): string {
  const normalizado = normalizeName(nome);
  ensure(normalizado.length > 0, 'nome', 'Dê um nome pra categoria');
  ensure(normalizado.length <= TAMANHO_MAXIMO_NOME, 'nome', `No máximo ${TAMANHO_MAXIMO_NOME} caracteres`);
  return normalizado;
}

export class Categoria {
  private constructor(private props: CategoriaProps) {}

  static criarPersonalizada(input: { id: string; nome: string; subscriberId: string; agora: Date }): Categoria {
    return new Categoria({
      id: input.id,
      slug: null,
      nome: normalizarNomeCategoria(input.nome),
      grupo: 'outros',
      icone: ICONE_PADRAO,
      ordem: 999,
      subscriberId: input.subscriberId,
      criadoEm: input.agora,
    });
  }

  static restaurar(props: CategoriaProps): Categoria {
    return new Categoria(structuredClone(props));
  }

  get id() { return this.props.id; }
  get slug() { return this.props.slug; }
  get nome() { return this.props.nome; }
  get grupo() { return this.props.grupo; }
  get icone() { return this.props.icone; }
  get ordem() { return this.props.ordem; }
  get subscriberId() { return this.props.subscriberId; }
  get criadoEm() { return this.props.criadoEm; }

  get ehDoCatalogo(): boolean {
    return this.props.subscriberId === null;
  }

  /** Catálogo é visível pra todos; personalizada, só pra dona. */
  ehVisivelPara(subscriberId: string | null): boolean {
    return this.ehDoCatalogo || (subscriberId !== null && this.props.subscriberId === subscriberId);
  }

  pertenceA(subscriberId: string): boolean {
    return this.props.subscriberId === subscriberId;
  }

  /** @throws BusinessRuleError em categoria do catálogo */
  renomear(nome: string): void {
    if (this.ehDoCatalogo) throw new BusinessRuleError('Categorias do catálogo não podem ser renomeadas.');
    this.props.nome = normalizarNomeCategoria(nome);
  }

  toSnapshot(): CategoriaProps {
    return structuredClone(this.props);
  }
}
