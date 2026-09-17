import { MAX_PAGE_LIMIT, type Page, type PageRequest } from '../../../shared/application/pagination';
import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { CategoriasRepository } from '../../categorias';
import type { CheckInsRepository } from '../../check-ins';
import type { DividasRepository } from '../../dividas';
import type { GastosFixosRepository } from '../../gastos-fixos';
import type { SubscribersRepository } from '../../identidade';
import type { MetasRepository } from '../../metas';
import type { PerfisRepository } from '../../perfil';
import type { VersoesPlanoRepository } from '../../planos';
import type { DadosExportados } from './dados-exportados';

export interface ExportarDadosInput {
  subscriberId: string;
}

/**
 * Lê uma listagem paginada até o fim. Planos e check-ins só existem paginados
 * no repositório, e a exportação precisa de todos os itens — parar na primeira página
 * entregaria um arquivo incompleto sem ninguém perceber.
 */
async function todasAsPaginas<T>(listar: (page: PageRequest) => Promise<Page<T>>): Promise<T[]> {
  const itens: T[] = [];
  let cursor: string | null = null;
  do {
    const pagina: Page<T> = await listar({ limit: MAX_PAGE_LIMIT, cursor });
    itens.push(...pagina.items);
    cursor = pagina.nextCursor;
  } while (cursor !== null);
  return itens;
}

/** Tudo que o dindin guarda sobre a pessoa, num objeto só (ver dados-exportados.ts). */
export class ExportarDadosUseCase implements UseCase<ExportarDadosInput, DadosExportados> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly perfis: PerfisRepository,
    private readonly gastosFixos: GastosFixosRepository,
    private readonly categorias: CategoriasRepository,
    private readonly dividas: DividasRepository,
    private readonly versoesPlano: VersoesPlanoRepository,
    private readonly metas: MetasRepository,
    private readonly checkIns: CheckInsRepository,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId }: ExportarDadosInput): Promise<DadosExportados> {
    const conta = await this.subscribers.findById(subscriberId);
    // a autenticação já conferiu a conta, mas ela pode ter sido excluída no meio do pedido
    if (!conta) throw new NotFoundError('Conta não encontrada.');

    // toda consulta é escopada pelo dono: dado de outra pessoa não tem como entrar
    const [perfil, gastos, visiveis, dividas, versoes, metas, checkIns] = await Promise.all([
      this.perfis.findBySubscriberId(subscriberId),
      this.gastosFixos.listBySubscriber(subscriberId),
      this.categorias.listVisible(subscriberId),
      this.dividas.listBySubscriber(subscriberId),
      todasAsPaginas((page) => this.versoesPlano.list(subscriberId, page)),
      this.metas.listBySubscriber(subscriberId),
      todasAsPaginas((page) => this.checkIns.list(subscriberId, page)),
    ]);

    const nomeDaCategoria = new Map(visiveis.map((c) => [c.id, c.nome]));

    return {
      exportadoEm: this.clock.now(),
      conta: {
        email: conta.email,
        criadoEm: conta.criadoEm,
        emailVerificadoEm: conta.emailVerificadoEm,
        ativo: conta.ativo,
      },
      perfil:
        perfil === null
          ? null
          : {
              rendaMensal: perfil.rendaMensal,
              tipoRenda: perfil.tipoRenda,
              idade: perfil.idade,
              moradia: perfil.moradia,
              custoMoradia: perfil.custoMoradia,
              guardado: perfil.guardado,
              atualizadoEm: perfil.atualizadoEm,
            },
      gastosFixos: gastos.map((gasto) => {
        const categoria = nomeDaCategoria.get(gasto.categoriaId);
        // a FK garante a categoria de um gasto gravado, e as visíveis cobrem catálogo + próprias: faltar é defeito
        if (categoria === undefined) {
          throw new Error(`Categoria ${gasto.categoriaId} do gasto ${gasto.id} não encontrada na exportação`);
        }
        return { categoria, valor: gasto.valor, criadoEm: gasto.criadoEm };
      }),
      categoriasPersonalizadas: visiveis
        .filter((c) => c.pertenceA(subscriberId))
        .map((c) => ({ nome: c.nome, criadoEm: c.criadoEm })),
      dividas: dividas.map((d) => ({
        tipo: d.tipo,
        saldo: d.saldo,
        parcela: d.parcela,
        taxaAnual: d.taxaAnual,
        criadoEm: d.criadoEm,
      })),
      planos: versoes.map((v) => ({
        versao: v.versao,
        criadoEm: v.criadoEm,
        entrada: v.inputSnap,
        resultado: v.resultado,
      })),
      metas: metas.map((m) => ({
        nome: m.nome,
        valorAlvo: m.valorAlvo,
        aporteMensal: m.aporteMensal,
        prazoMeses: m.prazoMeses,
        acumulado: m.acumulado,
        publicSlug: m.publicSlug,
        criadoEm: m.criadoEm,
        atualizadoEm: m.atualizadoEm,
      })),
      checkIns: checkIns.map((c) => ({
        competencia: c.competencia,
        rendaReal: c.rendaReal,
        gastoReal: c.gastoReal,
        guardadoReal: c.guardadoReal,
        enviadoEm: c.enviadoEm,
        respondidoEm: c.respondidoEm,
        criadoEm: c.criadoEm,
      })),
    };
  }
}
