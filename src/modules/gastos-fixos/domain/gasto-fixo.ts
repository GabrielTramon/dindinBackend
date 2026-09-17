import { ensureMoneyPrecision, validateField } from '../../../shared/domain/guards';
import { MAX_GASTOS_FIXOS } from '../../../shared/motor/config';
import { gastoFixoSchema } from '../../../shared/motor/schema';

/*
  Um gasto fixo do perfil, numa categoria (do catálogo ou personalizada).
  Uma linha por categoria por perfil — é o @@unique do banco.
*/

export { MAX_GASTOS_FIXOS };

export interface GastoFixoProps {
  id: string;
  /** dono do perfil (coluna profile_id, que referencia profiles.subscriber_id) */
  subscriberId: string;
  categoriaId: string;
  valor: number;
  criadoEm: Date;
}

// mesma regra de valor do onboarding (no zod 4, refine não esconde o .shape)
const esquemaValor = gastoFixoSchema.shape.valor;

function validarValor(valor: number): number {
  const v = validateField(esquemaValor, valor, 'valor');
  ensureMoneyPrecision(v, 'valor');
  return v;
}

export class GastoFixo {
  private constructor(private props: GastoFixoProps) {}

  static criar(input: { id: string; subscriberId: string; categoriaId: string; valor: number; agora: Date }): GastoFixo {
    return new GastoFixo({
      id: input.id,
      subscriberId: input.subscriberId,
      categoriaId: input.categoriaId,
      valor: validarValor(input.valor),
      criadoEm: input.agora,
    });
  }

  static restaurar(props: GastoFixoProps): GastoFixo {
    return new GastoFixo(structuredClone(props));
  }

  get id() { return this.props.id; }
  get subscriberId() { return this.props.subscriberId; }
  get categoriaId() { return this.props.categoriaId; }
  get valor() { return this.props.valor; }
  get criadoEm() { return this.props.criadoEm; }

  alterarValor(valor: number): void {
    this.props.valor = validarValor(valor);
  }

  toSnapshot(): GastoFixoProps {
    return structuredClone(this.props);
  }
}
