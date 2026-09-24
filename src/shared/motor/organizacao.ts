/*
  GERADO a partir de dindinFrontend/src/domain/organizacao.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { MAX_GRUPOS, MAX_ITENS_POR_GRUPO, MAX_RENDIMENTO_MENSAL, MESES_SIMULACAO_MAX } from "./config";
import type { Meta } from "./types";
import { arredondar } from "./format";

/*
  Organização do excedente em grupos e a projeção da meta.

  A base é o EXCEDENTE do mês (renda − custos), não o `livre`: a pessoa que diz
  "sobraram 3.000, quero organizar" está falando do excedente inteiro. O grupo
  "Guardar" — o aporte que a cascata já reservou — entra na lista como qualquer
  outro, marcado com `doSistema`, e é editável: é assim que "crio um grupo
  investimento e coloco um valor" convive com o plano em vez de brigar com ele.

  A porcentagem é SEMPRE derivada, nunca gravada. Gravar a porcentagem junto com
  o valor é ter duas fontes da verdade que discordam no primeiro recálculo.

  Puro: sem React, sem I/O, sem `new Date()` — a data de hoje entra por
  parâmetro, senão o mesmo perfil projeta um mês diferente a cada teste.
*/

export interface ItemGrupo {
  /** vem do cliente e sobrevive ao round-trip com o servidor */
  id: string;
  nome: string;
  /** reais/mês */
  valor: number;
}

export interface Grupo {
  id: string;
  nome: string;
  /** nome do componente no lucide-react, de catálogo fechado (metas-catalogo.ts) */
  icone: string;
  /** reais/mês; a % é derivada, NUNCA gravada */
  valor: number;
  /** "irá fazer parte da somatória para a meta financeira" */
  contaParaMeta: boolean;
  /** rendimento ao mês, 0,8% = 0.008; só no grupo — os itens herdam */
  rendimentoMensal?: number;
  /** o "Guardar" que a cascata preencheu */
  doSistema?: boolean;
  /** um nível só; a soma deve caber no valor do grupo, e o que sobra é o "restante" */
  itens: ItemGrupo[];
}

/** Um item já com a fatia que ocupa da base. */
export interface FatiaItem {
  id: string;
  nome: string;
  valor: number;
  /** fração exata da base, 0..1 — pra largura de barra */
  fatia: number;
  /** a fatia em pontos inteiros; os itens + o restante somam exatamente o `pct` do grupo */
  pct: number;
}

export interface GrupoOrganizado {
  id: string;
  nome: string;
  icone: string;
  valor: number;
  contaParaMeta: boolean;
  rendimentoMensal?: number;
  doSistema?: boolean;
  fatia: number;
  pct: number;
  itens: FatiaItem[];
  /** valor do grupo menos a soma dos itens; nunca negativo */
  restante: number;
  restanteFatia: number;
  restantePct: number;
}

export interface Organizacao {
  /** a base efetivamente usada; 0 quando o excedente é zero ou negativo (modo corte) */
  base: number;
  grupos: GrupoOrganizado[];
  totalOrganizado: number;
  /** base − total, nunca negativa: é o "livre pro dia a dia" */
  sobra: number;
  sobraFatia: number;
  sobraPct: number;
  /** a soma dos grupos passou da base */
  excedeu: boolean;
  /** quanto passou, em reais; 0 quando não passou */
  excesso: number;
}

export interface ProjecaoMeta {
  valorAlvo: number;
  /** o que entra por mês: os grupos que contam + o aporte do plano, quando ele conta */
  aporteMensal: number;
  /** meses até o alvo; null quando ninguém contribui ou quando nem em 50 anos chega */
  meses: number | null;
  /** o mês do alvo em texto, ex.: "março de 2028" */
  mesEstimado: string | null;
  /** o mesmo prazo ignorando o rendimento dos grupos — é o efeito dos juros, em meses */
  semRendimento: number | null;
}

/*
  Dinheiro vira centavo INTEIRO antes de qualquer rateio. É o que faz a soma
  fechar: em ponto flutuante, três grupos de 1/3 da base somam a base menos
  1e-13, e a tela mostra "faltou R$ 0,00" pra sempre.

  `arredondar` faz o arredondamento de dinheiro (2 casas); o Math.round aqui só
  tira o resíduo binário de multiplicar por 100 um número que já tem 2 casas.
  Valor negativo não existe em grupo nem em item: vira 0 em vez de furar o rateio.
*/
function emCentavos(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.max(0, Math.round(arredondar(valor) * 100));
}

function emReais(centavos: number): number {
  return arredondar(centavos / 100);
}

function somar(numeros: number[]): number {
  return numeros.reduce((acc, n) => acc + n, 0);
}

/*
  Maior resto: distribui `total` (um inteiro — centavos ou pontos percentuais)
  entre os pesos, proporcionalmente, e as unidades que sobram vão para os
  maiores restos. É o que impede "33% + 33% + 33% = 99%" e o que faz o ajuste
  proporcional fechar no centavo.

  Empate resolvido pelo índice: a mesma entrada sempre recebe a unidade a mais,
  então o mesmo dado devolve sempre o mesmo resultado.
*/
function distribuirInteiro(pesos: number[], total: number): number[] {
  const soma = somar(pesos);
  if (soma <= 0 || total <= 0) return pesos.map(() => 0);

  const exatos = pesos.map((p) => (p * total) / soma);
  const parte = exatos.map((e) => Math.floor(e));
  let faltam = total - somar(parte);

  const ordem = exatos
    .map((e, i) => ({ i, resto: e - Math.floor(e) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);

  for (const { i } of ordem) {
    if (faltam <= 0) break;
    parte[i] += 1;
    faltam -= 1;
  }
  return parte;
}

/** Base inválida, zero ou negativa (modo corte) não organiza nada. */
function baseUtil(base: number): number {
  return Number.isFinite(base) && base > 0 ? emCentavos(base) : 0;
}

/**
 * Reparte a base entre os grupos e devolve tudo o que a tela precisa: valor,
 * fatia e porcentagem de cada grupo, de cada item e do que sobrou.
 *
 * Nunca bloqueia e nunca corta: somar acima da base é um estado válido, só
 * marcado com `excedeu` pra tela avisar e oferecer o ajuste proporcional.
 */
export function organizarExcedente(base: number, grupos: Grupo[]): Organizacao {
  const baseCent = baseUtil(base);

  const gruposCent = grupos.map((g) => emCentavos(g.valor));
  const itensCent = grupos.map((g) => g.itens.map((i) => emCentavos(i.valor)));
  // item que estoure o valor do grupo não gera restante negativo: o "restante"
  // é o que ainda não tem nome dentro do grupo, e isso nunca é menos que zero
  const restanteCent = grupos.map((_, gi) => Math.max(0, gruposCent[gi] - somar(itensCent[gi])));

  const totalCent = somar(gruposCent);
  const sobraCent = Math.max(0, baseCent - totalCent);
  const excessoCent = Math.max(0, totalCent - baseCent);

  /*
    Quando a soma passa da base, a porcentagem passa a ser do que foi
    organizado. A barra continua fechando 100% (o aviso vermelho é que diz que
    passou), em vez de exibir "117% + 0%" e parecer bug.
  */
  const denominadorCent = Math.max(baseCent, totalCent);
  // base ≤ 0: nada de NaN nem Infinity — fatia 0 em tudo, e a seção nem aparece na tela
  const rateia = baseCent > 0 && denominadorCent > 0;

  // sempre com grupos.length + 1 posições: a última é a sobra
  const pesos = [...gruposCent, sobraCent];
  const pontos = rateia ? distribuirInteiro(pesos, 100) : pesos.map(() => 0);
  const fatiaDe = (centavos: number) => (rateia ? centavos / denominadorCent : 0);

  const organizados: GrupoOrganizado[] = grupos.map((g, gi) => {
    const pctGrupo = pontos[gi];
    // os pontos do grupo são repartidos entre os itens e o restante: assim a
    // soma dos itens exibida bate com a porcentagem do grupo, sem sobrar ponto
    const pontosInternos = distribuirInteiro([...itensCent[gi], restanteCent[gi]], pctGrupo);

    const itens: FatiaItem[] = g.itens.map((item, ii) => ({
      id: item.id,
      nome: item.nome,
      valor: emReais(itensCent[gi][ii]),
      fatia: fatiaDe(itensCent[gi][ii]),
      pct: pontosInternos[ii],
    }));

    return {
      id: g.id,
      nome: g.nome,
      icone: g.icone,
      valor: emReais(gruposCent[gi]),
      contaParaMeta: g.contaParaMeta,
      ...(g.rendimentoMensal !== undefined ? { rendimentoMensal: g.rendimentoMensal } : {}),
      ...(g.doSistema !== undefined ? { doSistema: g.doSistema } : {}),
      fatia: fatiaDe(gruposCent[gi]),
      pct: pctGrupo,
      itens,
      restante: emReais(restanteCent[gi]),
      restanteFatia: fatiaDe(restanteCent[gi]),
      restantePct: pontosInternos[pontosInternos.length - 1],
    };
  });

  return {
    base: emReais(baseCent),
    grupos: organizados,
    totalOrganizado: emReais(totalCent),
    sobra: emReais(sobraCent),
    sobraFatia: fatiaDe(sobraCent),
    sobraPct: pontos[pontos.length - 1],
    excedeu: excessoCent > 0,
    excesso: emReais(excessoCent),
  };
}

/**
 * Redistribui a base entre os grupos na proporção dos valores atuais, fechando
 * no centavo — nos grupos e dentro de cada grupo. É o botão "Ajustar
 * proporcionalmente" que aparece quando a soma passou da base.
 *
 * Devolve grupos novos; os de entrada não são tocados.
 *
 * Grupos todos em zero não têm proporção nenhuma: devolve tudo zero em vez de
 * inventar uma divisão igual que a pessoa não pediu (e, nesse estado, a soma
 * nunca passou da base, então o botão nem aparece).
 */
export function ajustarProporcionalmente(base: number, grupos: Grupo[]): Grupo[] {
  const baseCent = baseUtil(base);
  const gruposCent = grupos.map((g) => emCentavos(g.valor));
  const novosCent = distribuirInteiro(gruposCent, baseCent);

  return grupos.map((g, gi) => {
    const itensCent = g.itens.map((i) => emCentavos(i.valor));
    const restanteCent = Math.max(0, gruposCent[gi] - somar(itensCent));
    /*
      O "restante do grupo" entra no rateio como se fosse mais um item. Sem ele,
      encolher um grupo empurraria pros itens um dinheiro que a pessoa tinha
      deixado de fora deles de propósito — e um grupo de 600 com um item de 200
      voltaria com o item valendo 600.
    */
    const partes = distribuirInteiro([...itensCent, restanteCent], novosCent[gi]);

    return {
      ...g,
      valor: emReais(novosCent[gi]),
      itens: g.itens.map((item, ii) => ({ ...item, valor: emReais(partes[ii]) })),
    };
  });
}

/*
  Rendimento é sempre digitado pela pessoa — o dindin não sugere taxa, produto,
  banco nem corretora. O teto existe porque um dedo a mais no teclado ("8" em vez
  de "0,8") projetaria a meta em 3 meses e transformaria o plano em ficção.
*/
function taxaDoGrupo(rendimentoMensal: number | undefined): number {
  if (rendimentoMensal === undefined || !Number.isFinite(rendimentoMensal)) return 0;
  return Math.min(Math.max(0, rendimentoMensal), MAX_RENDIMENTO_MENSAL);
}

interface Contribuicao {
  valor: number;
  taxa: number;
}

/*
  Simulação mês a mês, no estilo de `simularQuitacao`: cada grupo tem o seu
  rendimento, então não dá pra usar a fórmula fechada de série uniforme — o
  saldo é a soma de vários saldos que crescem em ritmos diferentes.

  Saldo inicial ZERO por decisão de produto: o que já está guardado continua
  sendo reserva de emergência, não entrada da meta.

  A comparação é em centavos (via `arredondar`), como a tela mostra: em float a
  soma fica 1e-12 abaixo do alvo e o mês certo "some".
*/
function mesesAteOAlvo(contribuicoes: Contribuicao[], valorAlvo: number): number | null {
  if (valorAlvo <= 0) return 0;
  // saldo começa em zero: sem nenhum aporte, juro sobre nada continua sendo nada
  if (!contribuicoes.some((c) => c.valor > 0)) return null;

  const saldos = contribuicoes.map(() => 0);
  for (let mes = 1; mes <= MESES_SIMULACAO_MAX; mes++) {
    let total = 0;
    for (let i = 0; i < saldos.length; i++) {
      saldos[i] = saldos[i] * (1 + contribuicoes[i].taxa) + contribuicoes[i].valor;
      total += saldos[i];
    }
    if (arredondar(total) >= valorAlvo) return mes;
  }
  return null;
}

const MESES_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/*
  Aritmética de mês na mão, sem Intl e sem mexer no Date: somar meses com
  `setMonth` estoura (31 de março + 1 mês = 1º de maio) e o formatador de locale
  depende do ICU compilado no Node — no backend, o mesmo cálculo tem que dar a
  mesma frase.
*/
export function mesEmTexto(hoje: Date, meses: number): string | null {
  if (!(hoje instanceof Date) || Number.isNaN(hoje.getTime())) return null;
  const total = hoje.getMonth() + meses;
  const ano = hoje.getFullYear() + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12;
  return `${MESES_PT[mes]} de ${ano}`;
}

/**
 * Quanto tempo até a meta, com o rendimento que a pessoa declarou em cada grupo.
 *
 * `aporteDoPlanoQueConta` é o aporte da cascata e vem pronto: o chamador passa 0
 * quando ele ainda não conta (enquanto a pessoa paga cartão, esse dinheiro não
 * virou carro nenhum) e passa 0 também quando o grupo "Guardar" já está marcado
 * como contando — senão o mesmo real entraria duas vezes.
 *
 * `hoje` entra por parâmetro: o domínio não sabe que horas são.
 */
export function projetarMeta(
  meta: Meta,
  grupos: Grupo[],
  aporteDoPlanoQueConta: number,
  hoje: Date,
): ProjecaoMeta {
  const contribuicoes: Contribuicao[] = grupos
    .filter((g) => g.contaParaMeta)
    .map((g) => ({ valor: emReais(emCentavos(g.valor)), taxa: taxaDoGrupo(g.rendimentoMensal) }));

  // o aporte do plano não tem grupo, logo não tem rendimento declarado
  const doPlano = emReais(emCentavos(aporteDoPlanoQueConta));
  if (doPlano > 0) contribuicoes.push({ valor: doPlano, taxa: 0 });

  const aporteMensal = arredondar(somar(contribuicoes.map((c) => c.valor)));
  const valorAlvo = arredondar(Number.isFinite(meta.valorAlvo) ? meta.valorAlvo : 0);

  const meses = mesesAteOAlvo(contribuicoes, valorAlvo);
  const semRendimento = mesesAteOAlvo(
    contribuicoes.map((c) => ({ valor: c.valor, taxa: 0 })),
    valorAlvo,
  );

  return {
    valorAlvo,
    aporteMensal,
    meses,
    mesEstimado: meses === null ? null : mesEmTexto(hoje, meses),
    semRendimento,
  };
}

/** Cabe mais um grupo? O "Guardar" do sistema conta no limite. */
export function podeAdicionarGrupo(grupos: Grupo[]): boolean {
  return grupos.length < MAX_GRUPOS;
}

/** Cabe mais um item neste grupo? */
export function podeAdicionarItem(grupo: Grupo): boolean {
  return grupo.itens.length < MAX_ITENS_POR_GRUPO;
}
