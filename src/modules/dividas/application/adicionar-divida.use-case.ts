import type { Clock, IdGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { BusinessRuleError } from '../../../shared/domain/errors';
import { Divida, MAX_DIVIDAS, type TipoDivida } from '../domain/divida';
import type { DividasRepository } from '../domain/dividas-repository';
import type { PerfilGateway } from './ports';

export interface AdicionarDividaInput {
  subscriberId: string;
  tipo: TipoDivida;
  saldo: number;
  /** ausente ou null: sem parcela fixa */
  parcela?: number | null;
  /** ausente ou null: o motor usa a taxa padrão do tipo */
  taxaAnual?: number | null;
}

/** Uma dívida nova no perfil da pessoa. */
export class AdicionarDividaUseCase implements UseCase<AdicionarDividaInput, Divida> {
  constructor(
    private readonly dividas: DividasRepository,
    private readonly perfis: PerfilGateway,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: AdicionarDividaInput): Promise<Divida> {
    // valida antes de consultar qualquer coisa: campo errado responde 400 sem ir ao banco
    const divida = Divida.criar({
      id: this.ids.generate(),
      subscriberId: input.subscriberId,
      tipo: input.tipo,
      saldo: input.saldo,
      parcela: input.parcela ?? null,
      taxaAnual: input.taxaAnual ?? null,
      agora: this.clock.now(),
    });

    if (!(await this.perfis.exists(input.subscriberId))) {
      throw new BusinessRuleError('Crie seu perfil antes de adicionar dívidas.');
    }
    // Mesmo teto do schema do motor. Ler e depois gravar não segura dois pedidos simultâneos
    // (duplo clique): no pior caso passa uma a mais. O teto protege a tela e o motor de
    // listas enormes, não a integridade dos dados — travar o perfil a cada inclusão não compensa.
    if ((await this.dividas.countBySubscriber(input.subscriberId)) >= MAX_DIVIDAS) {
      throw new BusinessRuleError(
        `Você chegou no limite de ${MAX_DIVIDAS} dívidas. Remova uma que já quitou pra adicionar outra.`,
      );
    }

    await this.dividas.save(divida);
    return divida;
  }
}
