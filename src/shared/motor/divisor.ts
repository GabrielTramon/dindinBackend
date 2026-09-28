/*
  GERADO a partir de dindinFrontend/src/domain/divisor.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { RITMOS } from "./schema";
import { gerarPlano, type OpcoesMotor } from "./motor";
import { ajustarProporcionalmente, type Grupo } from "./organizacao";
import { LIVRE_MINIMO } from "./textos";
import type { Perfil, Plano, Ritmo } from "./types";
import { arredondar } from "./format";

/*
  O divisor do que sobra, em PORCENTAGEM.

  O modelo mental da tela é "o que sobra é 100% e você reparte em potes". O
  formato gravado continua em reais (Grupo.valor, Perfil.aporteEscolhido): a %
  é sempre derivada na leitura. Estes helpers são a ponte entre as duas coisas.

  O único limite é a sobra inteira: a soma dos potes fecha em 100%. O "Pra você"
  NÃO tem mínimo — quem protege a pessoa de ficar sem nada é a SUGESTÃO dos
  ritmos (o piso do motor), nunca uma trava na escolha dela. Quem quer chegar
  mais rápido pode pôr 100% nos potes.

  Puro: sem React, sem I/O, sem `new Date()`.
*/

/** Um ritmo simulado: o plano que ele gera e a % do que sobra que ele separa. */
export interface SimulacaoRitmo {
  ritmo: Ritmo;
  plano: Plano;
  /** Math.round(aporte / excedente × 100); 0 quando não sobra nada */
  pct: number;
}

/** Os limites do divisor: quanto cada pote ainda pode crescer sem passar da sobra. */
export interface LimitesDoDivisor {
  /** o que sobra no mês (excedente): o 100%; 0 em modo corte */
  base: number;
  /** o que fica "Pra você" com os potes de hoje (base − soma, nunca negativo): é o espaço que ainda dá pra dar a algum pote */
  livre: number;
  /** o máximo que o pote pode ter agora: o valor dele + o livre. Pote desconhecido = o livre. */
  maxDe: (id: string) => number;
  /** a soma dos potes passou da sobra — dado antigo (a sobra diminuiu) */
  passou: boolean;
  /** quanto a soma dos potes passa da sobra, em reais; 0 quando não passa */
  excesso: number;
}

const centavos = (valor: number): number =>
  Number.isFinite(valor) ? Math.max(0, Math.round(arredondar(valor) * 100)) : 0;

const reais = (cent: number): number => arredondar(cent / 100);

/** O perfil sem a escolha manual do "Guardar" — chave ausente, nunca `undefined`. */
function semAporteEscolhido(perfil: Perfil): Perfil {
  const copia = { ...perfil };
  delete copia.aporteEscolhido;
  return copia;
}

/** 840 de 1200 → 70. Base zero ou negativa → 0. Arredonda pro inteiro mais próximo. */
export function pctDe(valor: number, base: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(base) || base <= 0) return 0;
  return Math.round((Math.max(0, valor) / base) * 100);
}

/**
 * A % do "Guardar" — a MESMA no cartão do topo e no divisor. O motor guarda o
 * aporte em reais inteiros, então com a sobra em R$ 50,90 e o Guardar em 100%
 * ficam R$ 0,90 de fora. Menos de R$ 1 (LIVRE_MINIMO) é resíduo de centavos:
 * o Guardar levou tudo, e a % é 100 — não os 98 que `pctDe` daria.
 */
export function pctDoGuardar(valor: number, base: number): number {
  if (!(valor > 0) || !(base > 0) || !Number.isFinite(valor) || !Number.isFinite(base)) return pctDe(valor, base);
  const deFora = arredondar(base - valor);
  return deFora >= 0 && deFora < LIVRE_MINIMO ? 100 : pctDe(valor, base);
}

/** 70% de 1200 → 840. Arredonda no centavo. Base zero ou negativa → 0. */
export function valorDePct(pct: number, base: number): number {
  if (!Number.isFinite(pct) || !Number.isFinite(base) || base <= 0) return 0;
  return arredondar((Math.max(0, pct) / 100) * base);
}

/**
 * O R$ que uma % grava num pote que tem teto. Na % do teto (ou acima) grava o
 * teto EXATO: 77% de 1.200 são 924, mas o teto é 920 — gravar 924 passaria da
 * sobra em R$ 4 por causa do arredondamento da %.
 */
export function valorDePctNoTeto(pct: number, base: number, teto: number): number {
  const tetoValido = Math.max(0, Number.isFinite(teto) ? teto : 0);
  if (pct >= pctDe(tetoValido, base)) return arredondar(tetoValido);
  return Math.min(valorDePct(pct, base), arredondar(tetoValido));
}

/**
 * O próximo passo do [−]/[+]: anda até o múltiplo de `passo` seguinte (70 → 75,
 * 72 → 75, 75 → 70) e para no teto exato (75 → 77, não 80) e no zero.
 */
export function passoPct(atual: number, direcao: 1 | -1, max: number, passo = 5): number {
  const teto = Math.max(0, Math.floor(Number.isFinite(max) ? max : 0));
  const agora = Math.min(Math.max(0, Math.round(Number.isFinite(atual) ? atual : 0)), teto);
  const proximo =
    direcao > 0 ? (Math.floor(agora / passo) + 1) * passo : (Math.ceil(agora / passo) - 1) * passo;
  return Math.min(Math.max(0, proximo), teto);
}

/**
 * Um plano por ritmo, SEMPRE sem `aporteEscolhido` — nem o do perfil, nem o das
 * opções. Com ele, os três ritmos devolviam o mesmo número (o que a pessoa
 * digitou) e a tela mostrava três cartões iguais.
 *
 * A % já inclui o piso da sugestão: no acelerado limitado ela é a do teto, não
 * a da tabela. (O piso vale só aqui, na sugestão; à mão a pessoa vai até 100%.)
 */
export function simularRitmos(perfil: Perfil, opcoes: OpcoesMotor = {}): SimulacaoRitmo[] {
  const base = semAporteEscolhido(perfil);
  const opcoesSem: OpcoesMotor = { ...opcoes };
  delete opcoesSem.aporteEscolhido;
  return RITMOS.map((ritmo) => {
    const plano = gerarPlano({ ...base, ritmo }, opcoesSem);
    return { ritmo, plano, pct: pctDe(plano.aporte, plano.resumo.excedente) };
  });
}

/**
 * Os limites do divisor pra uma lista de potes — `grupos` é a lista INTEIRA,
 * com o "Guardar" (valor = aporte do plano) junto. Tudo comparado em centavos.
 *
 * Em modo corte (excedente ≤ 0) não há o que dividir: tudo zero, e `maxDe`
 * devolve o valor atual do pote (nada cresce).
 */
export function limitesDoDivisor(plano: Plano, grupos: Grupo[]): LimitesDoDivisor {
  const baseCent = plano.resumo.excedente > 0 ? centavos(plano.resumo.excedente) : 0;

  const valorDe = new Map(grupos.map((g) => [g.id, centavos(g.valor)]));
  const somaCent = grupos.reduce((acc, g) => acc + centavos(g.valor), 0);
  const livreCent = Math.max(0, baseCent - somaCent);

  return {
    base: reais(baseCent),
    livre: reais(livreCent),
    maxDe: (id: string) => reais((valorDe.get(id) ?? 0) + livreCent),
    passou: somaCent > baseCent,
    excesso: reais(Math.max(0, somaCent - baseCent)),
  };
}

/**
 * Os OUTROS potes (sem o "Guardar") depois de trocar o "Guardar" pro aporte de
 * `planoNovo` — o que acontece quando a pessoa toca num ritmo: iguais quando
 * cabem na sobra; encolhidos na proporção (itens junto) quando não cabem.
 * `null` = nada precisa mudar.
 *
 * Mora no domínio pra a projeção de cada ritmo (o "você chega em X" do
 * controle de ritmo) usar os MESMOS potes que a troca de ritmo vai gravar.
 */
export function outrosPotesQueCabem(planoNovo: Plano, grupos: Grupo[]): Grupo[] | null {
  const aporteNovo = planoNovo.aporte;
  const outros = grupos.filter((g) => !g.doSistema);
  if (outros.length === 0) return null;
  const sistema = grupos.find((g) => g.doSistema);
  const lista = sistema ? [{ ...sistema, valor: aporteNovo }, ...outros] : outros;
  const limites = limitesDoDivisor(planoNovo, lista);
  if (!limites.passou) return null;
  return ajustarProporcionalmente(arredondar(Math.max(0, limites.base - aporteNovo)), outros);
}

/**
 * Mantém a MESMA % de cada pote quando a sobra muda: os potes gravados em reais
 * sobre `baseReferencia` são reescalados pra `baseAtual`, proporcionalmente, em
 * centavos e por maior resto — com os itens escalados junto (a soma dos itens
 * nunca passa do pote).
 *
 * Sem `baseReferencia` (dado antigo), base atual ≤ 0 (modo corte: os potes ficam
 * guardados como estão e voltam proporcionais quando sobrar de novo) ou base que
 * não mudou no centavo: devolve os MESMOS grupos.
 */
export function reescalarGrupos(
  grupos: Grupo[],
  baseReferencia: number | undefined,
  baseAtual: number,
): Grupo[] {
  if (baseReferencia === undefined || !Number.isFinite(baseReferencia) || baseReferencia <= 0) return grupos;
  if (!Number.isFinite(baseAtual) || baseAtual <= 0) return grupos;
  const refCent = centavos(baseReferencia);
  const atualCent = centavos(baseAtual);
  if (refCent === atualCent || refCent === 0) return grupos;

  const somaCent = grupos.reduce((acc, g) => acc + centavos(g.valor), 0);
  // o total novo é a soma velha na mesma proporção da base; o rateio por maior
  // resto (grupos e itens) é o do "ajustar proporcionalmente", que já fecha no centavo
  const novoTotalCent = Math.round((somaCent * atualCent) / refCent);
  return ajustarProporcionalmente(reais(novoTotalCent), grupos);
}

/** A sobra do mês (excedente) de um perfil, pelo motor — a mesma conta da tela. */
function sobraDe(perfil: Perfil): number {
  return gerarPlano(semAporteEscolhido(perfil)).resumo.excedente;
}

/**
 * Refazer as respostas muda a sobra; o "Guardar" escolhido à mão guarda REAIS.
 * Aqui ele é reescalado pra continuar sendo a MESMA % da sobra: 60% de R$ 1.200
 * (R$ 720) vira R$ 900 quando a sobra vai pra R$ 1.500.
 *
 * - Sem `aporteEscolhido` no perfil novo: devolve o perfil novo como está.
 * - Sobra nova ≤ 0: a chave some (em corte não existe "Guardar").
 * - Sem perfil anterior, ou sobra anterior ≤ 0: sem razão pra aplicar, fica o valor.
 * Quem limita à sobra é o motor, não esta função.
 */
export function reescalarAporteEscolhido(perfilAnterior: Perfil | null, perfilNovo: Perfil): Perfil {
  const escolhido = perfilNovo.aporteEscolhido;
  if (escolhido === undefined) return perfilNovo;

  const sobraNova = sobraDe(perfilNovo);
  if (!(sobraNova > 0) || !Number.isFinite(escolhido)) return semAporteEscolhido(perfilNovo);
  if (perfilAnterior === null) return perfilNovo;

  const sobraAntiga = sobraDe(perfilAnterior);
  if (!(sobraAntiga > 0) || centavos(sobraAntiga) === centavos(sobraNova)) return perfilNovo;

  return { ...perfilNovo, aporteEscolhido: arredondar((Math.max(0, escolhido) * sobraNova) / sobraAntiga) };
}

/**
 * Partes de um todo em reais INTEIROS que fecham a soma, por maior resto: a
 * tela mostra R$ 662 + R$ 661 = R$ 1.323, e não R$ 662 + R$ 662.
 *
 * Quando os valores já somam `total` (o caso normal), cada um vai pro real de
 * baixo ou de cima dele mesmo; quando não somam, são repartidos na proporção.
 * Empate vai pro que vem primeiro. Negativo conta como 0; total ≤ 0 → zeros.
 */
export function repartirEmReaisInteiros(valores: number[], total: number): number[] {
  const totalInteiro = Number.isFinite(total) ? Math.round(total) : 0;
  const pesos = valores.map(centavos);
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (totalInteiro <= 0 || soma <= 0) return valores.map(() => 0);

  const exatos = pesos.map((p) => (p * totalInteiro) / soma);
  const partes = exatos.map((e) => Math.floor(e));
  let faltam = totalInteiro - partes.reduce((a, b) => a + b, 0);
  const ordem = exatos
    .map((e, i) => ({ i, resto: e - Math.floor(e) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of ordem) {
    if (faltam <= 0) break;
    partes[i] += 1;
    faltam -= 1;
  }
  return partes;
}
