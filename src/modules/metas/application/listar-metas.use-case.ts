import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import type { MetasRepository } from '../domain/metas-repository';
import { comProjecao, type MetaComProjecao } from './projecao-meta';

export interface ListarMetasInput {
  subscriberId: string;
}

/** As metas da pessoa, da mais recente pra mais antiga, cada uma com a projeção de hoje. */
export class ListarMetasUseCase implements UseCase<ListarMetasInput, MetaComProjecao[]> {
  constructor(
    private readonly metas: MetasRepository,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId }: ListarMetasInput): Promise<MetaComProjecao[]> {
    const metas = await this.metas.listBySubscriber(subscriberId);
    // um `agora` só: a lista inteira projetada a partir do mesmo mês
    const agora = this.clock.now();
    return metas.map((meta) => comProjecao(meta, agora));
  }
}
