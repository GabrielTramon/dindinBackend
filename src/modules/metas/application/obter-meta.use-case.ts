import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { MetasRepository } from '../domain/metas-repository';
import { comProjecao, type MetaComProjecao } from './projecao-meta';

export interface ObterMetaInput {
  subscriberId: string;
  metaId: string;
}

export class ObterMetaUseCase implements UseCase<ObterMetaInput, MetaComProjecao> {
  constructor(
    private readonly metas: MetasRepository,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId, metaId }: ObterMetaInput): Promise<MetaComProjecao> {
    // de outra pessoa o repositório devolve null, igual a inexistente: não confirma que o id existe
    const meta = await this.metas.findById(metaId, subscriberId);
    if (!meta) throw new NotFoundError('Meta não encontrada.');
    return comProjecao(meta, this.clock.now());
  }
}
