/*
  GERADO a partir de dindinFrontend/src/domain/config.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import type { Degrau, TipoDivida, TipoRenda } from "./types";

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
 * Fração do excedente que vai pra cascata, por degrau. O resto fica livre
 * pra gastos variáveis — um plano que zera o lazer é abandonado em 2 semanas.
 * Quanto mais urgente o degrau, mais agressivo o aporte.
 */
export const PROPORCAO_APORTE: Record<Degrau, number> = {
  0: 0.6,
  1: 0.7,
  2: 0.5,
  3: 0.4,
  4: 0.3,
};

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
