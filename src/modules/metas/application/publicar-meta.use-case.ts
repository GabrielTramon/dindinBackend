import type { Clock, IdGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors';
import { Meta } from '../domain/meta';
import type { MetasRepository } from '../domain/metas-repository';
import { comProjecao, type MetaComProjecao } from './projecao-meta';
import { gerarSlugPublico, TENTATIVAS_DE_SLUG } from './slug-publico';

export interface PublicarMetaInput {
  subscriberId: string;
  metaId: string;
}

/**
 * Dá à meta um endereço público (/meta/<slug>). Publicar de novo devolve o
 * mesmo endereço: o link que a pessoa já compartilhou continua valendo.
 */
export class PublicarMetaUseCase implements UseCase<PublicarMetaInput, MetaComProjecao> {
  constructor(
    private readonly metas: MetasRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId, metaId }: PublicarMetaInput): Promise<MetaComProjecao> {
    const meta = await this.metas.findById(metaId, subscriberId);
    if (!meta) throw new NotFoundError('Meta não encontrada.');

    const agora = this.clock.now();
    if (meta.publicSlug !== null) return comProjecao(meta, agora);

    /*
      A unicidade é garantida pela constraint do banco; isPublicSlugTaken só evita
      o erro no caso comum. Se outro pedido gravar o mesmo slug entre a checagem e
      o save, o repositório lança ConflictError e sorteamos outro sufixo.

      Capturar o ConflictError e seguir só é seguro porque isto NÃO roda dentro de
      transactions.run: no Postgres, depois do erro a transação fica abortada
      (25P02) e o próximo save falharia. Quem for embrulhar isto numa transação
      precisa repetir o run inteiro a cada tentativa.
    */
    for (let tentativa = 0; tentativa < TENTATIVAS_DE_SLUG; tentativa++) {
      const slug = gerarSlugPublico(meta.nome, this.ids);
      if (await this.metas.isPublicSlugTaken(slug)) continue;

      // publica numa cópia: se o save colidir, a meta carregada não fica com um slug que não foi gravado
      const publicada = Meta.restaurar(meta.toSnapshot());
      publicada.publicar(slug, agora);
      try {
        await this.metas.save(publicada);
        return comProjecao(publicada, agora);
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
    }

    throw new ConflictError('Não conseguimos criar o endereço público agora. Tente de novo em instantes.');
  }
}
