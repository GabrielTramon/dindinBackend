import type { Page } from '../../../shared/application/pagination';
import type { UseCase } from '../../../shared/application/use-case';
import type { CheckIn } from '../domain/check-in';
import type { CheckInsRepository } from '../domain/check-ins-repository';

export interface ListarCheckInsInput {
  subscriberId: string;
  limit: number;
  /** opaco (a competência codificada); ilegível vira ValidationError no repositório */
  cursor?: string | null;
}

/** Os check-ins da pessoa, do mês mais recente pro mais antigo. */
export class ListarCheckInsUseCase implements UseCase<ListarCheckInsInput, Page<CheckIn>> {
  constructor(private readonly checkIns: CheckInsRepository) {}

  execute({ subscriberId, limit, cursor }: ListarCheckInsInput): Promise<Page<CheckIn>> {
    return this.checkIns.list(subscriberId, { limit, cursor });
  }
}
