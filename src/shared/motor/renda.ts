/*
  GERADO a partir de dindinFrontend/src/domain/renda.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { TABELAS_FOLHA } from "./config";
import { arredondar } from "./format";

/*
  Salário bruto → líquido.

  Existe porque a pessoa quase sempre sabe o bruto do contrato e quase nunca
  sabe o líquido de cabeça — e `Perfil.rendaMensal` é líquido, é o número que
  toda a cascata usa. Aqui é só a conta fiscal do mês normal: bruto − INSS − IRRF.

  O que NÃO entra: vale-transporte, plano de saúde, vale-refeição, empréstimo
  consignado. Eles saem do holerite, mas no dindin são gasto fixo (o catálogo já
  tem `transporte_publico` e `plano_saude`). Descontar aqui E lá contaria o mesmo
  dinheiro duas vezes e derrubaria o excedente sem que ninguém visse por quê.

  Também não entra 13º, férias, hora extra nem rescisão: o motor planeja o mês
  normal, e a tela diz isso com todas as letras.

  Todas as tabelas vêm de TABELAS_FOLHA (config.ts). Nenhum número de tabela
  mora aqui: atualizar em janeiro tem que ser edição de dados, nunca de lógica.
*/

export interface Holerite {
  bruto: number;
  inss: number;
  irrf: number;
  liquido: number;
}

/**
 * Deduções da base do IRRF, mensais e em reais (Lei 9.250/95, art. 4º).
 * O INSS não está aqui de propósito: ele é sempre calculado a partir do próprio
 * rendimento, então não há como informar um e esquecer o outro.
 */
export interface DeducoesIRRF {
  /** quantidade de dependentes; cada um vale TABELAS_FOLHA.dependente */
  dependentes?: number;
  /** pensão alimentícia judicial paga no mês */
  pensaoAlimenticia?: number;
  /** previdência complementar descontada em folha */
  previdenciaFolha?: number;
}

/**
 * Estas funções rodam a cada tecla digitada no campo de renda, então entrada
 * inválida (vazia, negativa, NaN, Infinity) vira 0 em vez de exceção: a prévia
 * do líquido some ou mostra zero, e nunca quebra a tela no meio da digitação.
 */
function valorValido(valor: number | undefined): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/**
 * Contribuição do INSS do mês, progressiva: cada faixa incide só sobre a parcela
 * do rendimento que cai dentro dela. Acima do teto da última faixa a contribuição
 * trava no valor máximo — daí `Math.min`, sem nenhum caso especial.
 *
 * O `arredondar` é UM só, no total. Arredondar faixa a faixa erra por centavos
 * (R$ 2.500 dá 200,68 em vez de 200,69, porque 1.621 × 7,5% = 121,574999… em
 * ponto flutuante e cada faixa carrega o seu próprio meio-centavo). renda.test.ts
 * tem um teste que reproduz a versão errada de propósito, pra ninguém
 * "simplificar" isso depois.
 */
export function calcularINSS(rendimentoTributavelMensal: number): number {
  const rendimento = valorValido(rendimentoTributavelMensal);
  let contribuicao = 0;
  let pisoDaFaixa = 0;
  for (const faixa of TABELAS_FOLHA.inss) {
    if (rendimento <= pisoDaFaixa) break;
    contribuicao += (Math.min(rendimento, faixa.ate) - pisoDaFaixa) * faixa.aliquota;
    pisoDaFaixa = faixa.ate;
  }
  return arredondar(contribuicao);
}

/**
 * Redutor da Lei 15.270/2025, já apurado — ainda não limitado pelo imposto.
 *
 * A lei tem três faixas: até R$ 5.000 o redutor zera o imposto (valor de teto),
 * de R$ 5.000,01 até `ate` ele decresce pela reta `a − b × rendimento`, e acima
 * de `ate` não existe.
 *
 * Aqui as duas primeiras viram `min(teto, reta)`, que é a MESMA função: a reta
 * só fica abaixo do teto depois dos R$ 5.000 (ela cruza o teto em 5.000,0375).
 * Escrito assim, o limite da isenção é sempre onde a tabela diz que ele é —
 * enquanto um literal `5000` no código viraria mentira silenciosa no dia em que
 * a lei mudasse o teto sem mudar a reta. renda.test.ts confere as duas formas
 * centavo a centavo, e confere que a isenção da tabela de hoje cai em R$ 5.000.
 */
function redutorApurado(rendimentoTributavelMensal: number): number {
  const { teto, a, b, ate } = TABELAS_FOLHA.redutor;
  if (rendimentoTributavelMensal > ate) return 0;
  return Math.min(teto, Math.max(0, a - b * rendimentoTributavelMensal));
}

/**
 * Imposto de renda retido na fonte do mês.
 *
 * O parâmetro se chama `rendimentoTributavelMensal`, e não "salário", porque o
 * redutor da lei olha o rendimento do mês somando todas as fontes — quem tem
 * dois empregos não tem direito a dois redutores.
 *
 * Ordem: deduções legais (INSS + dependentes + pensão + previdência) OU o
 * desconto simplificado, o que for maior — o simplificado substitui as legais,
 * nunca soma com elas. Sobre a base sai o imposto pela faixa, com piso zero.
 * Só então entra o redutor, limitado ao imposto apurado pra nunca devolver
 * imposto negativo. `arredondar` uma vez, no fim: arredondar no meio faz o
 * centavo do INSS entrar duas vezes na conta.
 */
export function calcularIRRF(rendimentoTributavelMensal: number, deducoes: DeducoesIRRF = {}): number {
  const rendimento = valorValido(rendimentoTributavelMensal);
  if (rendimento === 0) return 0;

  // dependente é contagem, não dinheiro: fração e negativo viram 0 em vez de erro
  const dependentes = Math.trunc(valorValido(deducoes.dependentes));
  const legais =
    calcularINSS(rendimento) +
    dependentes * TABELAS_FOLHA.dependente +
    valorValido(deducoes.pensaoAlimenticia) +
    valorValido(deducoes.previdenciaFolha);

  const base = Math.max(0, rendimento - Math.max(legais, TABELAS_FOLHA.simplificado));
  // a última faixa tem `ate: Infinity`, então o find sempre acha; o ?? é só pro TypeScript
  const faixa = TABELAS_FOLHA.irrf.find((f) => base <= f.ate) ?? TABELAS_FOLHA.irrf[TABELAS_FOLHA.irrf.length - 1];
  const imposto = Math.max(0, base * faixa.aliquota - faixa.deduzir);

  const redutor = Math.min(redutorApurado(rendimento), imposto);
  return arredondar(Math.max(0, imposto - redutor));
}

/**
 * O holerite estimado do mês normal. É o que vira `Perfil.rendaMensal` quando a
 * pessoa informa o bruto em vez do que cai na conta.
 *
 * O bruto é arredondado ANTES da conta, não depois: assim `bruto − inss − irrf`
 * fecha exatamente no `liquido` que a tela mostra, mesmo que chegue aqui um
 * número com mais de duas casas vindo de uma máscara ou de uma divisão.
 *
 * Bruto abaixo do salário mínimo calcula igual (estágio e jovem aprendiz são a
 * persona do produto); quem avisa é a tela, lendo TABELAS_FOLHA.salarioMinimo.
 */
export function brutoParaLiquido(bruto: number, deducoes: DeducoesIRRF = {}): Holerite {
  const valor = arredondar(valorValido(bruto));
  const inss = calcularINSS(valor);
  const irrf = calcularIRRF(valor, deducoes);
  return { bruto: valor, inss, irrf, liquido: arredondar(valor - inss - irrf) };
}
