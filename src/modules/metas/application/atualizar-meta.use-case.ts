import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { MetasRepository } from '../domain/metas-repository';
import { comProjecao, type MetaComProjecao } from './projecao-meta';

export interface AtualizarMetaInput {
  subscriberId: string;
  metaId: string;
  /**
   * Ausente = não mexe. Pra trocar de aporte pra prazo, mande o prazo e
   * `aporteMensal: null` (e vice-versa).
   */
  nome?: string;
  valorAlvo?: number;
  aporteMensal?: number | null;
  prazoMeses?: number | null;
  acumulado?: number;
}

export class AtualizarMetaUseCase implements UseCase<AtualizarMetaInput, MetaComProjecao> {
  constructor(
    private readonly metas: MetasRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: AtualizarMetaInput): Promise<MetaComProjecao> {
    const meta = await this.metas.findById(input.metaId, input.subscriberId);
    if (!meta) throw new NotFoundError('Meta não encontrada.');

    const agora = this.clock.now();
    // campo a campo: a entrada nunca é espalhada, então subscriberId/metaId não viram dado da meta.
    // atualizar valida tudo antes de aplicar; se lançar, a meta fica como estava
    meta.atualizar(
      {
        nome: input.nome,
        valorAlvo: input.valorAlvo,
        aporteMensal: input.aporteMensal,
        prazoMeses: input.prazoMeses,
        acumulado: input.acumulado,
      },
      agora,
    );

    await this.metas.save(meta);
    return comProjecao(meta, agora);
  }
}
