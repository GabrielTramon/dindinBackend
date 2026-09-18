import { ValidationError } from '../../../shared/domain/errors';
import { ensureMoneyPrecision, invalid, validateField } from '../../../shared/domain/guards';
import { MORADIAS_SEM_CUSTO, perfilSchema } from '../../../shared/motor/schema';
import type { Meta, Moradia, RendaInformada, Ritmo, TipoRenda } from '../../../shared/motor/types';

/*
  O perfil financeiro: as respostas escalares do onboarding. Gastos fixos e
  dívidas são entidades próprias (módulos gastos-fixos e dividas) que apontam
  pra este perfil.

  Cada campo é validado com o schema do motor — os mesmos limites e mensagens
  do frontend — e dinheiro com no máximo 2 casas (o Decimal(12,2) do banco
  arredondaria em silêncio). Moradia sem custo (com os pais, casa quitada) zera
  o custo de moradia, igual o onboarding faz.

  Os campos opcionais (rendaInformada, salarioBruto, dependentes,
  competenciaTabela, ritmo, meta) são todos posteriores à v1 e por isso nunca
  obrigatórios: perfil respondido antes deles continua válido. Ausente é
  SEMPRE `undefined`, nunca `null`, e `toDados`/`toSnapshot` OMITEM a chave —
  chave presente com `null` mudaria o inputSnap de quem já tem plano gravado e
  criaria uma versão nova pra base inteira sem ninguém ter mudado nada.
*/

export interface DadosPerfil {
  /** SEMPRE o líquido: é o número que o motor usa */
  rendaMensal: number;
  /** o que a pessoa digitou no campo de renda; ausente = "liquida" */
  rendaInformada?: RendaInformada;
  /** o bruto informado, só como registro; o líquido nunca é recalculado a partir dele */
  salarioBruto?: number;
  dependentes?: number;
  /** competência da tabela de folha que gerou o líquido, ex.: "2026-01" */
  competenciaTabela?: string;
  /** quanto do que sobra vira aporte; ausente = "equilibrado" */
  ritmo?: Ritmo;
  /** o que a pessoa decidiu guardar por mês, no lugar do que o ritmo sugere */
  aporteEscolhido?: number;
  /** a meta principal: uma só */
  meta?: Meta;
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

/*
  "AAAA-MM". O motor só pede `string` porque quem grava é sempre
  TABELAS_FOLHA.competencia; a entidade aperta pelo mesmo motivo de
  ensureMoneyPrecision (o motor não limita casas, o armazenamento exige): a
  competência é comparada com a da tabela vigente pra avisar UMA vez que o
  líquido mudou, e um valor fora do formato deixaria o aviso ligado pra sempre.
*/
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export function moradiaSemCusto(moradia: Moradia): boolean {
  return (MORADIAS_SEM_CUSTO as readonly string[]).includes(moradia);
}

function dinheiro(schema: (typeof campos)['rendaMensal'], valor: unknown, campo: string): number {
  const v = validateField(schema, valor, campo);
  ensureMoneyPrecision(v, campo);
  return v;
}

function dinheiroOpcional(schema: (typeof campos)['salarioBruto'], valor: unknown, campo: string): number | undefined {
  const v = validateField(schema, valor, campo);
  // ausente não é zero: o campo simplesmente não foi respondido
  if (v === undefined) return undefined;
  ensureMoneyPrecision(v, campo);
  return v;
}

/**
 * A meta principal, validada pelo metaSchema do motor (que já recusa tipo
 * "outro" sem nome). Nome vazio nos outros tipos vira ausência: guardar `""`
 * faria o mesmo perfil voltar diferente do que entrou.
 */
function validarMeta(valor: unknown): Meta | undefined {
  const meta = validateField(campos.meta, valor, 'meta');
  if (meta === undefined) return undefined;
  ensureMoneyPrecision(meta.valorAlvo, 'meta.valorAlvo');
  const nome = meta.nome !== undefined && meta.nome.length > 0 ? meta.nome : undefined;
  return { tipo: meta.tipo, ...(nome !== undefined ? { nome } : {}), valorAlvo: meta.valorAlvo };
}

function validar(dados: DadosPerfil): DadosPerfil {
  const moradia = validateField(campos.moradia, dados.moradia, 'moradia');
  // valida sempre, mesmo quando vai zerar: um custo negativo ou texto não passa calado
  const custoMoradia = dinheiro(campos.custoMoradia, dados.custoMoradia, 'custoMoradia');

  const rendaInformada = validateField(campos.rendaInformada, dados.rendaInformada, 'rendaInformada');
  const salarioBruto = dinheiroOpcional(campos.salarioBruto, dados.salarioBruto, 'salarioBruto');
  /*
    "bruta" sem o bruto é RECUSADO, não ignorado. Ignorar gravaria um perfil que
    se diz calculado e não tem como ser reconferido: em janeiro, quando a tabela
    muda, a tela precisa dos dois números pra dizer "seu líquido passou de X pra
    Y". O caminho inverso é permitido de propósito — "Não bateu? Digitar o
    líquido" troca rendaInformada pra "liquida" e o bruto digitado fica no
    registro.
  */
  if (rendaInformada === 'bruta' && salarioBruto === undefined) {
    invalid('salarioBruto', 'Informe o seu salário bruto');
  }

  const competenciaTabela = validateField(campos.competenciaTabela, dados.competenciaTabela, 'competenciaTabela');
  if (competenciaTabela !== undefined && !COMPETENCIA.test(competenciaTabela)) {
    invalid('competenciaTabela', 'Competência no formato AAAA-MM');
  }

  const dependentes = validateField(campos.dependentes, dados.dependentes, 'dependentes');
  const ritmo = validateField(campos.ritmo, dados.ritmo, 'ritmo');
  const aporteEscolhido = dinheiroOpcional(campos.aporteEscolhido, dados.aporteEscolhido, 'aporteEscolhido');
  const meta = validarMeta(dados.meta);

  return {
    rendaMensal: dinheiro(campos.rendaMensal, dados.rendaMensal, 'rendaMensal'),
    ...(rendaInformada !== undefined ? { rendaInformada } : {}),
    ...(salarioBruto !== undefined ? { salarioBruto } : {}),
    ...(dependentes !== undefined ? { dependentes } : {}),
    ...(competenciaTabela !== undefined ? { competenciaTabela } : {}),
    ...(ritmo !== undefined ? { ritmo } : {}),
    ...(aporteEscolhido !== undefined ? { aporteEscolhido } : {}),
    ...(meta !== undefined ? { meta } : {}),
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
        rendaInformada: input.rendaInformada,
        salarioBruto: input.salarioBruto,
        dependentes: input.dependentes,
        competenciaTabela: input.competenciaTabela,
        ritmo: input.ritmo,
        aporteEscolhido: input.aporteEscolhido,
        meta: input.meta,
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
  get rendaInformada() { return this.props.rendaInformada; }
  get salarioBruto() { return this.props.salarioBruto; }
  get dependentes() { return this.props.dependentes; }
  get competenciaTabela() { return this.props.competenciaTabela; }
  get ritmo() { return this.props.ritmo; }
  get aporteEscolhido() { return this.props.aporteEscolhido; }
  /** cópia: `meta` é objeto, e quem lê o getter não pode mexer por dentro do perfil */
  get meta() { return this.props.meta === undefined ? undefined : structuredClone(this.props.meta); }
  get tipoRenda() { return this.props.tipoRenda; }
  get idade() { return this.props.idade; }
  get moradia() { return this.props.moradia; }
  get custoMoradia() { return this.props.custoMoradia; }
  get guardado() { return this.props.guardado; }
  get atualizadoEm() { return this.props.atualizadoEm; }

  /**
   * Troca TODAS as respostas de uma vez — é o PUT. Opcional ausente é APAGADO:
   * com `toDados()` omitindo a chave, reaproveitar `atualizar` aqui faria o
   * ritmo antigo sobreviver a um PUT que não mandou ritmo nenhum, e a escolha
   * ficaria gravada pra sempre sem ninguém conseguir desfazer.
   */
  substituir(dados: DadosPerfil, agora: Date): void {
    this.props = { ...validar(dados), subscriberId: this.props.subscriberId, atualizadoEm: agora };
  }

  /**
   * Aplica só os campos informados (undefined = não mexe) e revalida o conjunto
   * — é o PATCH. Sair de uma moradia sem custo pra uma com custo exige informar
   * o custo: o 0 guardado não era resposta, era "não se aplica".
   *
   * Campo opcional não tem como ser LIMPO por aqui (undefined já significa "não
   * mexe"); quem quer tirar o ritmo ou a meta manda o PUT sem eles.
   */
  atualizar(dados: Partial<DadosPerfil>, agora: Date): void {
    const novaMoradia = dados.moradia ?? this.props.moradia;
    if (moradiaSemCusto(this.props.moradia) && !moradiaSemCusto(novaMoradia) && dados.custoMoradia === undefined) {
      throw new ValidationError('Informe quanto sai de moradia', { custoMoradia: 'Informe quanto sai de moradia' });
    }
    const escolha = <K extends keyof DadosPerfil>(k: K): DadosPerfil[K] => (dados[k] !== undefined ? dados[k] : this.props[k]) as DadosPerfil[K];
    // campo a campo: espalhar a entrada deixaria uma chave extra (subscriberId, atualizadoEm) trocar o dono
    this.substituir(
      {
        rendaMensal: escolha('rendaMensal'),
        rendaInformada: escolha('rendaInformada'),
        salarioBruto: escolha('salarioBruto'),
        dependentes: escolha('dependentes'),
        competenciaTabela: escolha('competenciaTabela'),
        ritmo: escolha('ritmo'),
        aporteEscolhido: escolha('aporteEscolhido'),
        meta: escolha('meta'),
        tipoRenda: escolha('tipoRenda'),
        idade: escolha('idade'),
        moradia: escolha('moradia'),
        custoMoradia: escolha('custoMoradia'),
        guardado: escolha('guardado'),
      },
      agora,
    );
  }

  /** As respostas, sem dono nem data. Chave opcional ausente NÃO aparece. */
  toDados(): DadosPerfil {
    const p = this.props;
    return {
      rendaMensal: p.rendaMensal,
      ...(p.rendaInformada !== undefined ? { rendaInformada: p.rendaInformada } : {}),
      ...(p.salarioBruto !== undefined ? { salarioBruto: p.salarioBruto } : {}),
      ...(p.dependentes !== undefined ? { dependentes: p.dependentes } : {}),
      ...(p.competenciaTabela !== undefined ? { competenciaTabela: p.competenciaTabela } : {}),
      ...(p.ritmo !== undefined ? { ritmo: p.ritmo } : {}),
      ...(p.aporteEscolhido !== undefined ? { aporteEscolhido: p.aporteEscolhido } : {}),
      ...(p.meta !== undefined ? { meta: structuredClone(p.meta) } : {}),
      tipoRenda: p.tipoRenda,
      idade: p.idade,
      moradia: p.moradia,
      custoMoradia: p.custoMoradia,
      guardado: p.guardado,
    };
  }

  toSnapshot(): PerfilProps {
    return structuredClone(this.props);
  }
}
