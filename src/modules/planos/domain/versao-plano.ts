import { ensure } from '../../../shared/domain/guards';
import type { Perfil as PerfilDoMotor, Plano as PlanoDoMotor } from '../../../shared/motor/types';

/*
  Uma versão do plano: a entrada congelada e o resultado do motor naquele
  momento. Imutável — recalcular cria a próxima versão, nunca altera uma
  existente. É o histórico que permite mostrar "o que mudou desde o mês passado".
*/

export type { PerfilDoMotor, PlanoDoMotor };

/** Teto do INTEGER do Postgres (coluna versao). Acima disso o banco recusa a consulta. */
export const MAX_VERSAO = 2_147_483_647;

export interface VersaoPlanoProps {
  id: string;
  subscriberId: string;
  /** 1, 2, 3… por subscriber */
  versao: number;
  /** o perfil completo que entrou no motor (coluna input_snap) */
  inputSnap: PerfilDoMotor;
  resultado: PlanoDoMotor;
  criadoEm: Date;
}

/**
 * O valor no formato em que volta do JSONB: chave com `undefined` some e -0 vira 0.
 *
 * Sem isso, a memória guardaria `{ parcela: undefined }` e o Postgres não — a
 * comparação "o perfil mudou desde a última versão?" daria respostas
 * diferentes nos dois modos, e recalcular sem mudança criaria versão só no
 * banco. O motor só produz números, textos, booleanos, null e listas, então
 * a ida e volta por JSON não perde nada.
 */
export function normalizarComoJson<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

export class VersaoPlano {
  private constructor(private readonly props: VersaoPlanoProps) {}

  static criar(input: VersaoPlanoProps): VersaoPlano {
    ensure(
      Number.isInteger(input.versao) && input.versao >= 1 && input.versao <= MAX_VERSAO,
      'versao',
      'Versão inválida',
    );
    // campo a campo: chave extra vinda do chamador não entra na versão gravada
    return new VersaoPlano({
      id: input.id,
      subscriberId: input.subscriberId,
      versao: input.versao,
      inputSnap: normalizarComoJson(input.inputSnap),
      resultado: normalizarComoJson(input.resultado),
      criadoEm: new Date(input.criadoEm),
    });
  }

  static restaurar(props: VersaoPlanoProps): VersaoPlano {
    return new VersaoPlano(structuredClone(props));
  }

  get id() { return this.props.id; }
  get subscriberId() { return this.props.subscriberId; }
  get versao() { return this.props.versao; }
  // cópias: inputSnap e resultado são objetos aninhados, e a versão é imutável
  get inputSnap(): PerfilDoMotor { return structuredClone(this.props.inputSnap); }
  get resultado(): PlanoDoMotor { return structuredClone(this.props.resultado); }
  get criadoEm(): Date { return new Date(this.props.criadoEm); }

  toSnapshot(): VersaoPlanoProps {
    return structuredClone(this.props);
  }
}
