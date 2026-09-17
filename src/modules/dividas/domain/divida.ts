import { ensure, ensureMoneyPrecision, hasAtMostDecimals, validateField } from '../../../shared/domain/guards';
import { MAX_DIVIDAS } from '../../../shared/motor/config';
import { dividaSchema } from '../../../shared/motor/schema';
import type { TipoDivida } from '../../../shared/motor/types';

/*
  Uma dívida do perfil. Validada com o schema do motor: mesmos tipos, limites
  e mensagens do onboarding. Taxa ausente usa o padrão do tipo (config.ts do
  motor) na hora de gerar o plano.
*/

export { MAX_DIVIDAS };
export type { TipoDivida };

export interface DadosDivida {
  tipo: TipoDivida;
  saldo: number;
  parcela: number | null;
  /** 0.45 = 45% a.a.; null usa o padrão do tipo */
  taxaAnual: number | null;
}

export interface DividaProps extends DadosDivida {
  id: string;
  /** dono do perfil (coluna profile_id) */
  subscriberId: string;
  criadoEm: Date;
}

const campos = dividaSchema.shape;

function validar(dados: DadosDivida): DadosDivida {
  const saldo = validateField(campos.saldo, dados.saldo, 'saldo');
  ensureMoneyPrecision(saldo, 'saldo');

  let parcela: number | null = null;
  if (dados.parcela !== null) {
    parcela = validateField(campos.parcela, dados.parcela, 'parcela') ?? null;
    if (parcela !== null) ensureMoneyPrecision(parcela, 'parcela');
  }

  let taxaAnual: number | null = null;
  if (dados.taxaAnual !== null) {
    taxaAnual = validateField(campos.taxaAnual, dados.taxaAnual, 'taxaAnual') ?? null;
    // Decimal(8,4) no banco
    if (taxaAnual !== null) ensure(hasAtMostDecimals(taxaAnual, 4), 'taxaAnual', 'No máximo 4 casas decimais');
  }

  return { tipo: validateField(campos.tipo, dados.tipo, 'tipo'), saldo, parcela, taxaAnual };
}

export class Divida {
  private constructor(private props: DividaProps) {}

  static criar(input: DadosDivida & { id: string; subscriberId: string; agora: Date }): Divida {
    const dados = validar({ tipo: input.tipo, saldo: input.saldo, parcela: input.parcela, taxaAnual: input.taxaAnual });
    return new Divida({ ...dados, id: input.id, subscriberId: input.subscriberId, criadoEm: input.agora });
  }

  static restaurar(props: DividaProps): Divida {
    return new Divida(structuredClone(props));
  }

  get id() { return this.props.id; }
  get subscriberId() { return this.props.subscriberId; }
  get tipo() { return this.props.tipo; }
  get saldo() { return this.props.saldo; }
  get parcela() { return this.props.parcela; }
  get taxaAnual() { return this.props.taxaAnual; }
  get criadoEm() { return this.props.criadoEm; }

  /** Campos ausentes (undefined) ficam como estão; null limpa parcela e taxa. */
  atualizar(dados: Partial<DadosDivida>): void {
    const atual: DadosDivida = {
      tipo: this.props.tipo,
      saldo: this.props.saldo,
      parcela: this.props.parcela,
      taxaAnual: this.props.taxaAnual,
    };
    // campos um a um: uma chave extra vinda do chamador (id, subscriberId) nunca entra
    this.props = {
      ...this.props,
      ...validar({
        tipo: dados.tipo !== undefined ? dados.tipo : atual.tipo,
        saldo: dados.saldo !== undefined ? dados.saldo : atual.saldo,
        parcela: dados.parcela !== undefined ? dados.parcela : atual.parcela,
        taxaAnual: dados.taxaAnual !== undefined ? dados.taxaAnual : atual.taxaAnual,
      }),
    };
  }

  toSnapshot(): DividaProps {
    return structuredClone(this.props);
  }
}
