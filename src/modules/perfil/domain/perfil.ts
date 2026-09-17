import { ValidationError } from '../../../shared/domain/errors';
import { ensureMoneyPrecision, validateField } from '../../../shared/domain/guards';
import { MORADIAS_SEM_CUSTO, perfilSchema } from '../../../shared/motor/schema';
import type { Moradia, TipoRenda } from '../../../shared/motor/types';

/*
  O perfil financeiro: as respostas escalares do onboarding. Gastos fixos e
  dívidas são entidades próprias (módulos gastos-fixos e dividas) que apontam
  pra este perfil.

  Cada campo é validado com o schema do motor — os mesmos limites e mensagens
  do frontend — e dinheiro com no máximo 2 casas (o Decimal(12,2) do banco
  arredondaria em silêncio). Moradia sem custo (com os pais, casa quitada) zera
  o custo de moradia, igual o onboarding faz.
*/

export interface DadosPerfil {
  rendaMensal: number;
  tipoRenda: TipoRenda;
  idade: number;
  moradia: Moradia;
  custoMoradia: number;
  guardado: number;
}

export interface PerfilProps extends DadosPerfil {
  subscriberId: string;
  atualizadoEm: Date;
}

const campos = perfilSchema.shape;

export function moradiaSemCusto(moradia: Moradia): boolean {
  return (MORADIAS_SEM_CUSTO as readonly string[]).includes(moradia);
}

function dinheiro(schema: (typeof campos)['rendaMensal'], valor: unknown, campo: string): number {
  const v = validateField(schema, valor, campo);
  ensureMoneyPrecision(v, campo);
  return v;
}

function validar(dados: DadosPerfil): DadosPerfil {
  const moradia = validateField(campos.moradia, dados.moradia, 'moradia');
  // valida sempre, mesmo quando vai zerar: um custo negativo ou texto não passa calado
  const custoMoradia = dinheiro(campos.custoMoradia, dados.custoMoradia, 'custoMoradia');
  return {
    rendaMensal: dinheiro(campos.rendaMensal, dados.rendaMensal, 'rendaMensal'),
    tipoRenda: validateField(campos.tipoRenda, dados.tipoRenda, 'tipoRenda'),
    idade: validateField(campos.idade, dados.idade, 'idade'),
    moradia,
    custoMoradia: moradiaSemCusto(moradia) ? 0 : custoMoradia,
    guardado: dinheiro(campos.guardado, dados.guardado, 'guardado'),
  };
}

export class Perfil {
  private constructor(private props: PerfilProps) {}

  static criar(input: DadosPerfil & { subscriberId: string; agora: Date }): Perfil {
    return new Perfil({
      ...validar({
        rendaMensal: input.rendaMensal,
        tipoRenda: input.tipoRenda,
        idade: input.idade,
        moradia: input.moradia,
        custoMoradia: input.custoMoradia,
        guardado: input.guardado,
      }),
      subscriberId: input.subscriberId,
      atualizadoEm: input.agora,
    });
  }

  static restaurar(props: PerfilProps): Perfil {
    return new Perfil(structuredClone(props));
  }

  get subscriberId() { return this.props.subscriberId; }
  get rendaMensal() { return this.props.rendaMensal; }
  get tipoRenda() { return this.props.tipoRenda; }
  get idade() { return this.props.idade; }
  get moradia() { return this.props.moradia; }
  get custoMoradia() { return this.props.custoMoradia; }
  get guardado() { return this.props.guardado; }
  get atualizadoEm() { return this.props.atualizadoEm; }

  /**
   * Aplica só os campos informados (undefined = não mexe) e revalida o conjunto.
   * Sair de uma moradia sem custo pra uma com custo exige informar o custo: o 0
   * guardado não era resposta, era "não se aplica".
   */
  atualizar(dados: Partial<DadosPerfil>, agora: Date): void {
    const novaMoradia = dados.moradia ?? this.props.moradia;
    if (moradiaSemCusto(this.props.moradia) && !moradiaSemCusto(novaMoradia) && dados.custoMoradia === undefined) {
      throw new ValidationError('Informe quanto sai de moradia', { custoMoradia: 'Informe quanto sai de moradia' });
    }
    const escolha = <K extends keyof DadosPerfil>(k: K): DadosPerfil[K] => (dados[k] !== undefined ? dados[k] : this.props[k]) as DadosPerfil[K];
    this.props = {
      ...validar({
        rendaMensal: escolha('rendaMensal'),
        tipoRenda: escolha('tipoRenda'),
        idade: escolha('idade'),
        moradia: escolha('moradia'),
        custoMoradia: escolha('custoMoradia'),
        guardado: escolha('guardado'),
      }),
      subscriberId: this.props.subscriberId,
      atualizadoEm: agora,
    };
  }

  toDados(): DadosPerfil {
    const { rendaMensal, tipoRenda, idade, moradia, custoMoradia, guardado } = this.props;
    return { rendaMensal, tipoRenda, idade, moradia, custoMoradia, guardado };
  }

  toSnapshot(): PerfilProps {
    return structuredClone(this.props);
  }
}
