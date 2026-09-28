/*
  GERADO a partir de dindinFrontend/src/domain/beneficios.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { DESCONTO_VT_MAXIMO } from "./config";
import type { Beneficio, BeneficiosDoMes, GastoFixo, TipoBeneficio } from "./types";
import { arredondar } from "./format";

/*
  Vales e benefícios: VR, VA, VT e o que mais a empresa der.

  Vale não é dinheiro na conta: é um cartão que só paga certas coisas. Somar o
  VR na renda faria o plano mandar GUARDAR um dinheiro que não sai do cartão —
  com R$ 800 de VR e R$ 300 de mercado, R$ 500 "sobrariam" pra reserva, e não
  sobram. A regra é uma só: **o vale entra no plano até o valor dos gastos
  fixos que ele paga.** O resto fica no cartão (`semUso`) e a tela diz isso.

  O custo do mês continua cheio (o vale não apaga o mercado da lista). É o
  custo cheio que dimensiona a reserva: quem perde o emprego perde o vale junto
  e passa a pagar o mercado do próprio bolso.

  Puro: só dados e conta.
*/

export interface BeneficioCatalogo {
  tipo: TipoBeneficio;
  nome: string;
  /** nome do componente no lucide-react (desenhado por <IconeCategoria />) */
  icone: string;
  /**
   * os slugs de gasto fixo que ele paga, na ordem em que paga; null = qualquer
   * gasto fixo que os vales de antes não pagaram
   */
  paga: readonly string[] | null;
}

/*
  VR e VA pagam comida, os dois: na lei um é pra restaurante e o outro pra
  mercado, mas os cartões de hoje aceitam os dois lados, e pra quem planeja o
  mês comida é comida. Cada um começa pelo seu (VR pela refeição, VA pelo
  mercado) e cobre o outro com o que sobrar.

  VT paga transporte público e, se sobrar, combustível (o "mobilidade" dos
  cartões flexíveis). "Outro" (auxílio home office, creche, educação…) vem por
  último e paga o que ainda não foi pago — nunca além disso.
*/
export const BENEFICIOS: readonly BeneficioCatalogo[] = [
  { tipo: "refeicao", nome: "Vale-refeição", icone: "Utensils", paga: ["refeicao", "mercado"] },
  { tipo: "alimentacao", nome: "Vale-alimentação", icone: "ShoppingBasket", paga: ["mercado", "refeicao"] },
  { tipo: "transporte", nome: "Vale-transporte", icone: "Bus", paga: ["transporte_publico", "combustivel"] },
  { tipo: "outro", nome: "Outro benefício", icone: "Ticket", paga: null },
];

const POR_TIPO = new Map(BENEFICIOS.map((b) => [b.tipo, b]));

export function beneficioPorTipo(tipo: TipoBeneficio): BeneficioCatalogo | undefined {
  return POR_TIPO.get(tipo);
}

/** O nome que a tela mostra: o que a pessoa deu ao "outro", ou o do catálogo. */
export function nomeDoBeneficio(b: Pick<Beneficio, "tipo" | "nome">): string {
  if (b.tipo === "outro") return b.nome?.trim() || "Outro benefício";
  return beneficioPorTipo(b.tipo)?.nome ?? "Benefício";
}

/** Um vale como o perfil guarda ou como o onboarding ainda está digitando (valor em branco). */
type ValeDigitado = Pick<Beneficio, "tipo"> & { valor?: number };

/** Vale estranho (negativo, NaN) conta como nada: a tela nunca quebra no meio da digitação. */
function valorValido(valor: number | undefined): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/**
 * Os vales de um tipo, somados — o que a tela chama de "o seu VT". Aceita o
 * rascunho do onboarding (valor ainda em branco conta como nada).
 */
export function valorDoBeneficio(
  beneficios: readonly ValeDigitado[] | undefined,
  tipo: TipoBeneficio,
): number {
  return arredondar((beneficios ?? []).filter((b) => b.tipo === tipo).reduce((acc, b) => acc + valorValido(b.valor), 0));
}

/**
 * Quanto dos vales paga gasto fixo — e quanto fica no cartão sem uso.
 *
 * Os específicos pagam primeiro, cada um os seus gastos, na ordem do catálogo;
 * o "outro" vem por último e paga o que eles não pagaram. Nada passa do valor
 * do gasto: R$ 800 de VR com R$ 300 de mercado pagam 300, e os 500 ficam em
 * `semUso`. Tudo em centavos, como o resto do motor.
 *
 * Aceita o rascunho do onboarding (valor em branco conta como nada): a
 * pergunta dos gastos mostra "os vales pagam R$ X" com esta mesma conta.
 */
export function aplicarBeneficios(
  beneficios: readonly ValeDigitado[] | undefined,
  gastos: readonly (Pick<GastoFixo, "categoria"> & { valor?: number })[],
): BeneficiosDoMes {
  const lista = (beneficios ?? []).filter((b) => valorValido(b.valor) > 0);
  const total = arredondar(lista.reduce((acc, b) => acc + valorValido(b.valor), 0));
  if (total === 0) return { total: 0, pagaGastos: 0, semUso: 0 };

  // o que falta pagar de cada gasto; o vale vai descontando daqui
  const falta = gastos.map((g) => valorValido(g.valor));
  const ordem = [...lista].sort((a, b) => ordemNoCatalogo(a.tipo) - ordemNoCatalogo(b.tipo));

  let pagaGastos = 0;
  for (const b of ordem) {
    let saldo = valorValido(b.valor);
    const paga = beneficioPorTipo(b.tipo)?.paga ?? null;
    // a ordem dos slugs é a ordem de preferência; `null` passa pelos gastos na ordem da lista
    const indices =
      paga === null
        ? falta.map((_, i) => i)
        : paga.flatMap((slug) => gastos.flatMap((g, i) => (g.categoria === slug ? [i] : [])));
    for (const i of indices) {
      if (saldo <= 0) break;
      const pago = Math.min(saldo, falta[i]);
      falta[i] -= pago;
      saldo -= pago;
      pagaGastos += pago;
    }
  }

  const paga = arredondar(pagaGastos);
  return { total, pagaGastos: paga, semUso: arredondar(total - paga) };
}

/**
 * Os vales (do catálogo, não o "outro") que não acham NENHUM gasto da lista pra
 * pagar. Sem o mercado na lista, o VR não paga nada e o plano fica igual ao de
 * quem não tem vale — a pergunta dos gastos usa isto pra lembrar a pessoa.
 */
export function beneficiosSemGasto(
  beneficios: readonly ValeDigitado[] | undefined,
  gastos: readonly { categoria: string }[],
): BeneficioCatalogo[] {
  const categorias = new Set(gastos.map((g) => g.categoria));
  const tipos = new Set((beneficios ?? []).filter((b) => valorValido(b.valor) > 0).map((b) => b.tipo));
  return BENEFICIOS.filter((b) => tipos.has(b.tipo) && b.paga !== null && !b.paga.some((slug) => categorias.has(slug)));
}

function ordemNoCatalogo(tipo: TipoBeneficio): number {
  const i = BENEFICIOS.findIndex((b) => b.tipo === tipo);
  return i < 0 ? BENEFICIOS.length : i;
}

/**
 * O desconto do vale-transporte no holerite: a empresa pode descontar até 6%
 * do salário, e nunca mais que o próprio vale (Lei 7.418/85, art. 4º).
 *
 * Só existe pra quem informou o BRUTO: quem informou o que cai na conta já
 * recebeu com o desconto feito. Sem ele, o VT pagaria o transporte inteiro e o
 * plano esqueceria os 6% que saíram do salário.
 */
export function descontoDoValeTransporte(salarioBruto: number, valeTransporte: number): number {
  const bruto = valorValido(salarioBruto);
  const vale = valorValido(valeTransporte);
  return arredondar(Math.min(bruto * DESCONTO_VT_MAXIMO, vale));
}
