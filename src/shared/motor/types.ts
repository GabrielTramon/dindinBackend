/*
  GERADO a partir de dindinFrontend/src/domain/types.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

/*
  Tipos do domínio do dindin.
  Tudo aqui é puro: sem React, sem I/O, sem Next.
  Nomes em português porque são termos do produto (renda, reserva, degrau).
*/

export type TipoRenda = "clt" | "pj" | "informal";

/** O que a pessoa digitou no campo de renda: o salário bruto ou o que cai na conta. */
export type RendaInformada = "bruta" | "liquida";

/**
 * Quanto do que sobra vira aporte. Não muda a ordem da cascata — só o tamanho
 * do passo. A tabela por degrau está em config.ts (PROPORCAO_APORTE).
 */
export type Ritmo = "leve" | "equilibrado" | "acelerado";

export type MetaTipo =
  | "carro"
  | "casa"
  | "liberdade"
  | "emergencia"
  | "viagem"
  | "estudos"
  | "outro";

/** A meta principal: uma só, escolhida no onboarding. */
export interface Meta {
  tipo: MetaTipo;
  /** obrigatório quando o tipo é "outro" */
  nome?: string;
  valorAlvo: number;
}

export type Moradia = "pais" | "aluguel" | "dividido" | "propria" | "financiada";

export type TipoDivida =
  | "rotativo"
  | "cheque_especial"
  | "emprestimo"
  | "financiamento"
  | "outra";

export interface Divida {
  tipo: TipoDivida;
  /** saldo devedor total, em reais */
  saldo: number;
  /** parcela mensal já paga hoje, em reais (0 ou ausente se não há parcela fixa) */
  parcela?: number;
  /** taxa anual, ex.: 0.45 = 45% a.a.; ausente → usa o padrão do tipo em config.ts */
  taxaAnual?: number;
}

/** Um gasto fixo do mês, já categorizado. */
export interface GastoFixo {
  /** slug do catálogo em categorias.ts; SLUG_OUTRO quando a pessoa criou a categoria */
  categoria: string;
  /** nome dado pela pessoa — obrigatório quando a categoria é "outro" */
  nome?: string;
  /** quanto sai por mês, em reais */
  valor: number;
}

/**
 * As 9 respostas do onboarding.
 *
 * Os campos opcionais são todos posteriores à v1 e por isso nunca obrigatórios:
 * perfil salvo no navegador antes deles continua válido. Ausente é sempre
 * `undefined`, nunca `null` — é o que mantém o snapshot do plano estável.
 */
export interface Perfil {
  /**
   * renda LÍQUIDA mensal, em reais — é o número que todo o motor usa.
   * Quando a pessoa informa o bruto, este campo recebe o líquido calculado.
   */
  rendaMensal: number;
  /** o que a pessoa digitou; ausente = "liquida" (como era antes do cálculo de bruto) */
  rendaInformada?: RendaInformada;
  /** o bruto informado, guardado como registro; o motor não recalcula a partir dele */
  salarioBruto?: number;
  /** dependentes para o IRRF */
  dependentes?: number;
  /** competência da tabela que gerou o líquido, ex.: "2026-01" — em janeiro avisa que mudou */
  competenciaTabela?: string;
  /** ausente = "equilibrado" */
  ritmo?: Ritmo;
  meta?: Meta;
  tipoRenda: TipoRenda;
  idade: number;
  moradia: Moradia;
  /** aluguel ou parcela + condomínio; 0 quando mora com os pais ou casa quitada */
  custoMoradia: number;
  /** gastos fixos fora moradia, item a item: mercado, academia, celular… */
  gastosFixos: GastoFixo[];
  dividas: Divida[];
  /** quanto já tem guardado hoje (poupança, conta rendendo) */
  guardado: number;
}

/**
 * Degrau da cascata em que a pessoa está:
 * 0 fôlego mínimo · 1 dívida cara · 2 reserva · 3 dívida média · 4 metas
 */
export type Degrau = 0 | 1 | 2 | 3 | 4;

export type ClasseDivida = "cara" | "media" | "barata";

export interface DividaAvaliada extends Divida {
  taxaAnual: number;
  classe: ClasseDivida;
  /** quanto essa dívida custa por mês só de juros, em reais */
  jurosMensais: number;
}

/** Um gasto fixo pronto pra tela: nome resolvido, ícone e peso no total. */
export interface GastoFixoDetalhado extends GastoFixo {
  /** o nome dado pela pessoa, ou o nome da categoria do catálogo */
  nomeExibido: string;
  /** nome do componente no lucide-react */
  icone: string;
  /** fatia do custo fixo total, entre 0 e 1 */
  fatia: number;
}

export type Destino =
  | "folego"
  | "divida_cara"
  | "reserva"
  | "divida_media"
  | "metas";

/** Uma fatia do aporte do mês indo para um degrau da cascata. */
export interface Alocacao {
  destino: Destino;
  valor: number;
  titulo: string;
  descricao: string;
}

export interface Resumo {
  renda: number;
  custoMoradia: number;
  /** soma dos gastos fixos informados */
  custoFixo: number;
  /** soma das parcelas de dívida informadas */
  parcelas: number;
  custoTotal: number;
  /** renda − custoTotal; pode ser negativo */
  excedente: number;
  /** excedente / renda, entre −∞ e 1 */
  taxaExcedente: number;
}

export interface Folego {
  alvo: number;
  atual: number;
  falta: number;
  ok: boolean;
}

export interface Reserva {
  multiplicador: 3 | 6;
  alvo: number;
  atual: number;
  falta: number;
  ok: boolean;
  /** meses até completar com o aporte atual; null quando o aporte está indo pra outro degrau */
  mesesParaCompletar: number | null;
}

export interface QuadroDividas {
  avaliadas: DividaAvaliada[];
  caras: DividaAvaliada[];
  medias: DividaAvaliada[];
  baratas: DividaAvaliada[];
  totalCaras: number;
  totalMedias: number;
  /** juros mensais somados das dívidas caras */
  jurosMensaisCaras: number;
  /** meses pra quitar todas as caras com o aporte atual; null = nunca, com esse aporte */
  mesesParaQuitarCaras: number | null;
  mesesParaQuitarMedias: number | null;
}

export interface PlanoDeCorte {
  /** quanto os custos passam da renda, em reais */
  deficit: number;
  /** quanto precisa cortar pra sobrar a margem mínima */
  metaCorte: number;
  /** a meta em palavras — o que cortar e o que isso libera */
  metaTexto: string;
  /** onde cortar, em ordem de impacto */
  sugestoes: string[];
}

export interface Decisao {
  titulo: string;
  texto: string;
}

/**
 * Como o piso do que fica livre tratou o aporte deste mês. Existe pra tela
 * poder explicar um número que não é o da tabela do ritmo: "nesse ritmo o
 * máximo aqui é R$ X — abaixo disso o plano não se sustenta".
 */
export interface PisoAporte {
  /** o que o ritmo escolhido pediria, sem piso nenhum */
  sugerido: number;
  /** o teto que o piso deixa passar neste degrau */
  teto: number;
  /** true quando o teto cortou o sugerido — só acontece no acelerado */
  mordeu: boolean;
}

/** Por que uma simulação de quitação não terminou. */
export type MotivoSemQuitacao = "juros" | "horizonte";

/**
 * Por que as dívidas caras não têm prazo neste plano — e se outro ritmo
 * resolve. Sem isso o texto afirma "é o único caminho" ao lado de um cartão
 * que oferece justamente o outro caminho.
 */
export interface DiagnosticoDividaCara {
  motivo: MotivoSemQuitacao;
  /** o ritmo mais lento, entre os três, que zera as caras; null = nenhum zera */
  ritmoQueResolve: Ritmo | null;
  /** prazo nesse ritmo, em meses; null quando nenhum resolve */
  mesesNoRitmoQueResolve: number | null;
}

export interface Plano {
  perfil: Perfil;
  resumo: Resumo;
  /** gastos fixos do maior pro menor, prontos pra tela */
  gastosFixos: GastoFixoDetalhado[];
  modoCorte: boolean;
  corte: PlanoDeCorte | null;
  degrau: Degrau;
  decisao: Decisao;
  /** o ritmo que gerou este plano — já resolvido (perfil.ritmo ou o padrão) */
  ritmo: Ritmo;
  /** parte do excedente que vai pra cascata este mês */
  aporte: number;
  /** de onde saiu o aporte: o que o ritmo pedia e o teto que o piso impôs */
  piso: PisoAporte;
  /** parte do excedente que fica livre pra gastos variáveis */
  livre: number;
  alocacoes: Alocacao[];
  folego: Folego;
  reserva: Reserva;
  dividas: QuadroDividas;
  /**
   * só existe quando há dívida cara sem prazo fora do modo corte; null quando
   * há prazo, quando não há dívida cara, ou em modo corte (aí quem fala é `corte`)
   */
  diagnosticoCaras: DiagnosticoDividaCara | null;
  proximosPassos: string[];
}
