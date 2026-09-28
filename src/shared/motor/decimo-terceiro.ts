/*
  GERADO a partir de dindinFrontend/src/domain/decimo-terceiro.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { descontoDoValeTransporte, valorDoBeneficio } from "./beneficios";
import { DECIMO_TERCEIRO } from "./config";
import type { DecimoTerceiroNoPlano, Perfil } from "./types";
import { arredondar } from "./format";

/*
  O 13º no plano.

  Ele não entra no aporte do mês: não existe nos outros onze meses, e somar
  1/12 dele por mês faria o plano mandar gastar hoje um dinheiro que só cai em
  dezembro. Ele entra como ENTRADA EXTRA nas projeções — inteiro, no mês em que
  cai, no passo da vez (o que passar segue pro passo seguinte, como qualquer
  real da cascata). O mês a mês do plano continua o mesmo; os prazos encurtam.

  Quanto: o líquido de um mês. É a estimativa honesta sem saber quando a pessoa
  começou no emprego (o 13º é proporcional aos meses do ano) nem a tributação
  exclusiva do 13º — e a tela diz que é estimativa. Pra quem informou o bruto
  com vale-transporte, o desconto do VT volta: ele não sai do 13º.

  Puro: `hoje` entra por parâmetro.
*/

/** Dinheiro que entra no plano fora do aporte do mês, por mês da projeção (1 = este mês). */
export type EntradaExtra = (mes: number) => number;

type PerfilDoDecimo = Pick<
  Perfil,
  "decimoTerceiro" | "tipoRenda" | "rendaMensal" | "rendaInformada" | "salarioBruto" | "beneficios"
>;

/**
 * O 13º estimado, líquido. 0 quando a pessoa não usa no plano ou é informal
 * (a pergunta nem aparece pra ela; um "sim" antigo, de quando ela era CLT, não
 * vale mais).
 */
export function valorDoDecimoTerceiro(perfil: PerfilDoDecimo): number {
  if (perfil.decimoTerceiro !== true || perfil.tipoRenda === "informal") return 0;
  const liquido = Number.isFinite(perfil.rendaMensal) ? Math.max(0, perfil.rendaMensal) : 0;
  const doBruto = perfil.tipoRenda === "clt" && perfil.rendaInformada === "bruta" && perfil.salarioBruto !== undefined;
  const vt = doBruto
    ? descontoDoValeTransporte(perfil.salarioBruto ?? 0, valorDoBeneficio(perfil.beneficios, "transporte"))
    : 0;
  return arredondar(liquido + vt);
}

/**
 * Em que mês da projeção o próximo 13º cai: setembro → 4 (set, out, nov, dez).
 * Em dezembro até o dia 20, é este mês (1); depois, o do ano que vem (13).
 */
export function primeiroMesDoDecimo(hoje: Date): number | null {
  if (!(hoje instanceof Date) || Number.isNaN(hoje.getTime())) return null;
  const mes = hoje.getMonth();
  if (mes === DECIMO_TERCEIRO.mes) return hoje.getDate() <= DECIMO_TERCEIRO.diaLimite ? 1 : 13;
  return ((DECIMO_TERCEIRO.mes - mes + 12) % 12) + 1;
}

/**
 * O 13º como entrada extra das projeções: `valor` no primeiro mês e a cada 12
 * depois. null quando não há o que somar — é o que mantém o caminho de quem
 * não usa o 13º idêntico, bit a bit, ao de antes.
 */
export function entradasDoDecimo(
  decimo: Pick<DecimoTerceiroNoPlano, "valor" | "primeiroMes"> | null,
): EntradaExtra | null {
  if (decimo === null || decimo.primeiroMes === null || !(decimo.valor > 0)) return null;
  const { valor, primeiroMes } = decimo;
  return (mes) => (mes >= primeiroMes && (mes - primeiroMes) % 12 === 0 ? valor : 0);
}

/** Quanto do 13º cai nos meses 1..n da projeção — o "em 1 ano" de quem não tem meta. */
export function decimoNosProximosMeses(decimo: DecimoTerceiroNoPlano | null, n: number): number {
  const extra = entradasDoDecimo(decimo);
  if (extra === null) return 0;
  let total = 0;
  for (let mes = 1; mes <= n; mes++) total += extra(mes);
  return arredondar(total);
}
