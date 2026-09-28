import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { MetasRepository } from '../domain/metas-repository';

export interface RemoverMetaInput {
  subscriberId: string;
  metaId: string;
}

/** Exclusão física. Se estava publicada, o endereço público deixa de existir junto. */
export class RemoverMetaUseCase implements UseCase<RemoverMetaInput, void> {
  constructor(private readonly metas: MetasRepository) {}

  async execute({ subscriberId, metaId }: RemoverMetaInput): Promise<void> {
    // o delete filtra pelo dono e não falha sem linha; a busca antes existe pra responder 404
    const meta = await this.metas.findById(metaId, subscriberId);
    if (!meta) throw new NotFoundError('Meta não encontrada.');
    await this.metas.delete(meta.id, subscriberId);
  }
}
