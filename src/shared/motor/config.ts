/*
  GERADO a partir de dindinFrontend/src/domain/config.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import type { Degrau, Ritmo, TipoDivida, TipoRenda } from "./types";

/*
  Constantes do motor. Tudo que é "regra de bolso" fica aqui, com o porquê,
  pra ser ajustado sem mexer na lógica.
*/

/**
 * Taxa livre de risco anual usada como referência (Selic/CDI).
 * FALLBACK — na Fase A1 o valor passa a vir da API do Banco Central (SGS)
 * com cache diário. Ajuste este número quando a Selic mudar.
 */
export const TAXA_LIVRE_RISCO_ANUAL = 0.12;

/**
 * Acima disso a dívida é "cara": recebe 100% do aporte antes da reserva.
 * Rotativo, cheque especial e crédito pessoal ficam muito acima. Financiamento
 * de veículo (~20–30% a.a.) fica abaixo de propósito — dívida estruturada é
 * antecipada depois da reserva, não antes.
 */
export const LIMIAR_DIVIDA_CARA = 0.3;

/**
 * Taxas anuais padrão por tipo, usadas quando o usuário não informa.
 * Referência aproximada das séries do BCB para pessoa física; revisar por semestre.
 */
export const TAXAS_PADRAO: Record<TipoDivida, number> = {
  rotativo: 4.3, // ~430% a.a.
  cheque_especial: 1.5, // teto regulatório de 8% a.m.
  emprestimo: 0.9, // crédito pessoal não consignado
  financiamento: 0.24, // veículo
  outra: 0.4,
};

/** Fôlego mínimo: entre R$ 300 e R$ 1.000, limitado por um mês de custo total. */
export const FOLEGO_PISO = 300;
export const FOLEGO_TETO = 1000;

/** Reserva de emergência em meses de custo total, por tipo de vínculo. */
export const MULTIPLICADOR_RESERVA: Record<TipoRenda, 3 | 6> = {
  clt: 3,
  pj: 6,
  informal: 6,
};

/**
 * Fração do excedente que vai pra cascata, por degrau e por ritmo. O resto fica
 * livre pra gastos variáveis — um plano que zera o lazer é abandonado em 2 semanas.
 * Quanto mais urgente o degrau, mais agressivo o aporte.
 *
 * "equilibrado" é a tabela original, palavra por palavra: quem não escolhe ritmo
 * recebe exatamente o plano de sempre.
 *
 * Quem protege a sobra é o piso em motor.ts (nunca menos de 10% da renda livre,
 * e nunca menos do que o equilibrado guardaria), não um teto baixo aqui. Foi o
 * que a tela provou: com 0,70 no degrau 1 o acelerado mostrava exatamente o
 * mesmo número do equilibrado — um cartão que não muda nada não é escolha.
 */
export const PROPORCAO_APORTE: Record<Ritmo, Record<Degrau, number>> = {
  leve: { 0: 0.45, 1: 0.5, 2: 0.35, 3: 0.25, 4: 0.15 },
  equilibrado: { 0: 0.6, 1: 0.7, 2: 0.5, 3: 0.4, 4: 0.3 },
  acelerado: { 0: 0.8, 1: 0.85, 2: 0.7, 3: 0.6, 4: 0.5 },
};

export const RITMO_PADRAO: Ritmo = "equilibrado";

/**
 * O ÚNICO jeito de ler a proporção. O aporte do mês e as projeções ("zera em X
 * meses") leem a mesma regra por aqui: se cada um lesse a tabela por conta
 * própria, o plano diria "guarde 300" e projetaria com 500.
 */
export function proporcaoAporte(ritmo: Ritmo | undefined, degrau: Degrau): number {
  return PROPORCAO_APORTE[ritmo ?? RITMO_PADRAO][degrau];
}

/** Em modo corte, a meta é liberar pelo menos esta fração da renda. */
export const MARGEM_MINIMA_CORTE = 0.1;

/** Aluguel acima desta fração da renda vira sugestão explícita de corte. */
export const LIMIAR_MORADIA_PESADA = 0.3;

/** Simulações de quitação param aqui (50 anos) e devolvem null. */
export const MESES_SIMULACAO_MAX = 600;

export const MAX_DIVIDAS = 6;

/** Teto de linhas de gasto fixo. Acima disso a pessoa está fazendo planilha, não plano. */
export const MAX_GASTOS_FIXOS = 20;

/** Quantos gastos o plano de corte nomeia como "os maiores". */
export const MAIORES_GASTOS_NO_CORTE = 3;

/** Teto de grupos (o "Guardar" do sistema conta) e de itens dentro de um grupo. */
export const MAX_GRUPOS = 6;
export const MAX_ITENS_POR_GRUPO = 5;

/** Rendimento mensal que a pessoa pode declarar num grupo: até 5% a.m. */
export const MAX_RENDIMENTO_MENSAL = 0.05;

/**
 * Tabelas da folha de pagamento, em um literal só: atualizar em janeiro é
 * editar dados, nunca lógica.
 *
 * Fontes: INSS pela Portaria Interministerial MPS/MF nº 13, de 09/01/2026;
 * IRRF pela tabela mensal da Receita Federal (inalterada desde maio/2025);
 * redutor pela Lei 15.270/2025, em vigor desde 01/01/2026.
 *
 * `vigenciaAte` não é decoração: renda.test.ts compara a data de hoje com ela e
 * fica vermelho sozinho quando a tabela vence. Comentário "conferir em janeiro"
 * nunca falha; teste falha.
 */
export const TABELAS_FOLHA = {
  competencia: "2026-01",
  vigenciaAte: "2026-12-31",
  /** alíquota PROGRESSIVA: cada faixa incide só sobre a parcela dentro dela */
  inss: [
    { ate: 1621.0, aliquota: 0.075 },
    { ate: 2902.84, aliquota: 0.09 },
    { ate: 4354.27, aliquota: 0.12 },
    { ate: 8475.55, aliquota: 0.14 },
  ],
  /** imposto = base × alíquota − deduzir */
  irrf: [
    { ate: 2428.8, aliquota: 0, deduzir: 0 },
    { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
    { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
    { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
    { ate: Infinity, aliquota: 0.275, deduzir: 908.73 },
  ],
  /** dedução mensal por dependente */
  dependente: 189.59,
  /** desconto simplificado: substitui TODAS as deduções legais, nunca soma com elas */
  simplificado: 607.2,
  /**
   * Redutor da Lei 15.270/2025, aplicado DEPOIS do imposto apurado e olhando o
   * rendimento tributável do mês (não a base): até 5.000 zera o imposto; de
   * 5.000,01 a 7.350 decresce até zero.
   *
   * `teto` é o literal da lei de propósito: a fórmula em 5.000 dá 312,895, que
   * arredonda pra 312,90 e passa a devolver imposto negativo de um centavo.
   */
  redutor: { teto: 312.89, a: 978.62, b: 0.133145, ate: 7350 },
  salarioMinimo: 1621.0,
} as const;
