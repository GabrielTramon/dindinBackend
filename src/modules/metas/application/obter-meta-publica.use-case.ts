import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { MetasRepository } from '../domain/metas-repository';

export interface ObterMetaPublicaInput {
  slug: string;
}

/**
 * O que a página pública mostra. Só nome e percentual: valores em reais,
 * id e dono nunca saem daqui, nem por engano no presenter.
 */
export interface MetaPublica {
  nome: string;
  progresso: number;
  atingida: boolean;
}

export class ObterMetaPublicaUseCase implements UseCase<ObterMetaPublicaInput, MetaPublica> {
  constructor(private readonly metas: MetasRepository) {}

  async execute({ slug }: ObterMetaPublicaInput): Promise<MetaPublica> {
    const meta = await this.metas.findByPublicSlug(slug);
    if (!meta) throw new NotFoundError('Essa meta não existe ou deixou de ser pública.');
    return { nome: meta.nome, progresso: meta.progresso, atingida: meta.atingida };
  }
}
