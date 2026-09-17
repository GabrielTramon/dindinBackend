import { SLUG_OUTRO } from '../../../shared/motor/categorias';
import { arredondar } from '../../../shared/motor/format';
import type { Perfil as PerfilDoMotor } from '../../../shared/motor/types';
import type { UseCase } from '../../../shared/application/use-case';
import { ValidationError } from '../../../shared/domain/errors';
import { normalizarNomeCategoria, type Categoria, type CategoriasRepository } from '../../categorias';
import type { Divida, DividasRepository } from '../../dividas';
import type { GastoFixo, GastosFixosRepository } from '../../gastos-fixos';
import type { Perfil } from '../domain/perfil';
import type { PerfisRepository } from '../domain/perfis-repository';

/*
  Perfil completo no formato do motor (e do frontend): as respostas escalares
  + gastos fixos + dívidas, numa estrutura só. É a entrada de gerarPlano e o
  corpo de GET/PUT /perfil/completo.

  Gasto em categoria do catálogo vira { categoria: slug }; em categoria
  personalizada vira { categoria: "outro", nome } — exatamente como o
  onboarding do frontend representa.
*/

export type { PerfilDoMotor };

export function montarPerfilDoMotor(
  perfil: Perfil,
  gastos: readonly GastoFixo[],
  categoriasPorId: ReadonlyMap<string, Categoria>,
  dividas: readonly Divida[],
): PerfilDoMotor {
  return {
    ...perfil.toDados(),
    gastosFixos: gastos.map((gasto) => {
      const categoria = categoriasPorId.get(gasto.categoriaId);
      // FK garante que existe; faltar aqui é defeito, não entrada inválida
      if (!categoria) throw new Error(`Categoria ${gasto.categoriaId} do gasto ${gasto.id} não carregada`);
      return categoria.slug !== null && categoria.slug !== SLUG_OUTRO
        ? { categoria: categoria.slug, valor: gasto.valor }
        : { categoria: SLUG_OUTRO, nome: categoria.nome, valor: gasto.valor };
    }),
    dividas: dividas.map((d) => ({
      tipo: d.tipo,
      saldo: d.saldo,
      ...(d.parcela !== null ? { parcela: d.parcela } : {}),
      ...(d.taxaAnual !== null ? { taxaAnual: d.taxaAnual } : {}),
    })),
  };
}

/*
  O caminho inverso: gastos no formato do frontend → categorias do banco.

  O frontend e o banco discordam em três pontos, e é aqui que se resolve:
  1. o onboarding deixa repetir "outro" (cada um com nome próprio) e não impede
     dois "Clube"; o banco só aceita UMA linha por categoria por perfil;
  2. o frontend não conhece os nomes do catálogo: "outro: Mercado" é o Mercado;
  3. o nome livre vira categoria personalizada, que precisa existir antes do gasto.

  Regras, na ordem:
  - slug do catálogo → aquela categoria;
  - "outro" + nome → nome igual (sem maiúsculas) a uma do catálogo? usa a do catálogo;
    a uma personalizada da pessoa? reaproveita; senão, categoria nova;
  - linhas que caem na mesma categoria são SOMADAS (a primeira dá o nome e a posição).
*/

type GastoDoMotor = PerfilDoMotor['gastosFixos'][number];

export type GastoResolvido =
  | { tipo: 'existente'; categoria: Categoria; valor: number }
  | { tipo: 'nova'; nome: string; valor: number };

function comCaminho(error: unknown, indice: number): never {
  if (error instanceof ValidationError && error.details) {
    const details = Object.fromEntries(
      Object.entries(error.details).map(([campo, msg]) => [`gastosFixos.${indice}.${campo}`, msg]),
    );
    throw new ValidationError(error.message, details);
  }
  throw error;
}

export function resolverGastosDoMotor(gastos: readonly GastoDoMotor[], visiveis: readonly Categoria[]): GastoResolvido[] {
  const chave = (nome: string) => nome.toLocaleLowerCase('pt-BR');
  const doCatalogoPorSlug = new Map(visiveis.filter((c) => c.ehDoCatalogo && c.slug).map((c) => [c.slug as string, c]));
  const doCatalogoPorNome = new Map(visiveis.filter((c) => c.ehDoCatalogo).map((c) => [chave(c.nome), c]));
  const propriasPorNome = new Map(visiveis.filter((c) => !c.ehDoCatalogo).map((c) => [chave(c.nome), c]));

  const agrupados = new Map<string, GastoResolvido>();

  gastos.forEach((gasto, i) => {
    let resolvido: GastoResolvido;

    if (gasto.categoria !== SLUG_OUTRO) {
      const categoria = doCatalogoPorSlug.get(gasto.categoria);
      if (!categoria) {
        throw new ValidationError('Categoria desconhecida.', { [`gastosFixos.${i}.categoria`]: 'Categoria desconhecida' });
      }
      resolvido = { tipo: 'existente', categoria, valor: gasto.valor };
    } else {
      let nome: string;
      try {
        nome = normalizarNomeCategoria(gasto.nome ?? '');
      } catch (error) {
        comCaminho(error, i);
      }
      const existente = doCatalogoPorNome.get(chave(nome)) ?? propriasPorNome.get(chave(nome));
      resolvido = existente
        ? { tipo: 'existente', categoria: existente, valor: gasto.valor }
        : { tipo: 'nova', nome, valor: gasto.valor };
    }

    const k = resolvido.tipo === 'existente' ? `id:${resolvido.categoria.id}` : `nova:${chave(resolvido.nome)}`;
    const anterior = agrupados.get(k);
    agrupados.set(k, anterior ? { ...anterior, valor: arredondar(anterior.valor + resolvido.valor) } : resolvido);
  });

  return [...agrupados.values()];
}

export interface CarregarPerfilDoMotorInput {
  subscriberId: string;
}

/** null quando a pessoa ainda não tem perfil. */
export class CarregarPerfilDoMotorUseCase implements UseCase<CarregarPerfilDoMotorInput, PerfilDoMotor | null> {
  constructor(
    private readonly perfis: PerfisRepository,
    private readonly gastosFixos: GastosFixosRepository,
    private readonly categorias: CategoriasRepository,
    private readonly dividas: DividasRepository,
  ) {}

  async execute({ subscriberId }: CarregarPerfilDoMotorInput): Promise<PerfilDoMotor | null> {
    const perfil = await this.perfis.findBySubscriberId(subscriberId);
    if (!perfil) return null;

    const [gastos, dividas, categorias] = await Promise.all([
      this.gastosFixos.listBySubscriber(subscriberId),
      this.dividas.listBySubscriber(subscriberId),
      this.categorias.listVisible(subscriberId),
    ]);
    return montarPerfilDoMotor(perfil, gastos, new Map(categorias.map((c) => [c.id, c])), dividas);
  }
}
