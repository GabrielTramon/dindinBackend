import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import type { Divida, TipoDivida } from '../domain/divida';
import type { DividasRepository } from '../domain/dividas-repository';

export interface AlterarDividaInput {
  subscriberId: string;
  dividaId: string;
  /** undefined = não mexe */
  tipo?: TipoDivida;
  saldo?: number;
  /** undefined = não mexe; null = sem parcela fixa */
  parcela?: number | null;
  /** undefined = não mexe; null = volta pra taxa padrão do tipo */
  taxaAnual?: number | null;
}

export class AlterarDividaUseCase implements UseCase<AlterarDividaInput, Divida> {
  constructor(private readonly dividas: DividasRepository) {}

  async execute(input: AlterarDividaInput): Promise<Divida> {
    const divida = await this.dividas.findById(input.dividaId, input.subscriberId);
    // de outra pessoa responde igual a inexistente: não confirma que o id existe
    if (!divida) throw new NotFoundError('Dívida não encontrada.');

    // campo a campo: nada além dos dados da dívida chega na entidade
    divida.atualizar({
      tipo: input.tipo,
      saldo: input.saldo,
      parcela: input.parcela,
      taxaAnual: input.taxaAnual,
    });

    await this.dividas.save(divida);
    return divida;
  }
}
