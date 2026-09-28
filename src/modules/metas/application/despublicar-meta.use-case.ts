import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { MetasRepository } from '../domain/metas-repository';
import { comProjecao, type MetaComProjecao } from './projecao-meta';

export interface DespublicarMetaInput {
  subscriberId: string;
  metaId: string;
}

/**
 * Tira a meta do ar. O endereço antigo passa a responder 404 e fica livre;
 * publicar de novo gera outro — o link compartilhado antes não volta a funcionar.
 */
export class DespublicarMetaUseCase implements UseCase<DespublicarMetaInput, MetaComProjecao> {
  constructor(
    private readonly metas: MetasRepository,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId, metaId }: DespublicarMetaInput): Promise<MetaComProjecao> {
    const meta = await this.metas.findById(metaId, subscriberId);
    if (!meta) throw new NotFoundError('Meta não encontrada.');

    const agora = this.clock.now();
    // já privada: nada a gravar, e atualizadoEm não muda por um pedido que não mudou nada
    if (meta.publicSlug === null) return comProjecao(meta, agora);

    meta.despublicar(agora);
    await this.metas.save(meta);
    return comProjecao(meta, agora);
  }
}
