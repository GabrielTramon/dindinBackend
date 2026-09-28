import type { Clock, IdGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { BusinessRuleError } from '../../../shared/domain/errors';
import { MAX_METAS, Meta } from '../domain/meta';
import type { MetasRepository } from '../domain/metas-repository';
import { comProjecao, type MetaComProjecao } from './projecao-meta';

export interface CriarMetaInput {
  subscriberId: string;
  nome: string;
  valorAlvo: number;
  /** um entre aporteMensal e prazoMeses; null ou ausente = não informado */
  aporteMensal?: number | null;
  prazoMeses?: number | null;
  acumulado?: number;
}

export class CriarMetaUseCase implements UseCase<CriarMetaInput, MetaComProjecao> {
  constructor(
    private readonly metas: MetasRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: CriarMetaInput): Promise<MetaComProjecao> {
    const agora = this.clock.now();
    // valida antes de consultar qualquer coisa: entrada errada responde 400/422 sem ir ao banco
    const meta = Meta.criar({
      id: this.ids.generate(),
      subscriberId: input.subscriberId,
      nome: input.nome,
      valorAlvo: input.valorAlvo,
      aporteMensal: input.aporteMensal,
      prazoMeses: input.prazoMeses,
      acumulado: input.acumulado,
      agora,
    });

    // limite de uso, não de integridade: dois pedidos simultâneos com 19 metas
    // gravam a 20ª e a 21ª, e isso não quebra nada — por isso não vale uma trava
    if ((await this.metas.countBySubscriber(input.subscriberId)) >= MAX_METAS) {
      throw new BusinessRuleError(`Você chegou no limite de ${MAX_METAS} metas. Remova uma que não faz mais sentido.`);
    }

    await this.metas.save(meta);
    return comProjecao(meta, agora);
  }
}
