import { ensure } from '../../../shared/domain/guards';
import type { Perfil as PerfilDoMotor, Plano as PlanoDoMotor } from '../../../shared/motor/types';

/*
  Uma versão do plano: a entrada congelada e o resultado do motor naquele
  momento. Imutável — recalcular cria a próxima versão, nunca altera uma
  existente. É o histórico que permite mostrar "o que mudou desde o mês passado".
*/

export type { PerfilDoMotor, PlanoDoMotor };

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

export class VersaoPlano {
  private constructor(private readonly props: VersaoPlanoProps) {}

  static criar(input: VersaoPlanoProps): VersaoPlano {
    ensure(Number.isInteger(input.versao) && input.versao >= 1, 'versao', 'Versão inválida');
    return new VersaoPlano(structuredClone(input));
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
