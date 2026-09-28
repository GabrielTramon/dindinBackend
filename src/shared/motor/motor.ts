/*
  GERADO a partir de dindinFrontend/src/domain/motor.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { aplicarBeneficios } from "./beneficios";
import { categoriaPorSlug, ICONE_PADRAO } from "./categorias";
import {
  FOLEGO_PISO,
  FOLEGO_TETO,
  LIMIAR_DIVIDA_CARA,
  LIMIAR_MORADIA_PESADA,
  MAIORES_GASTOS_NO_CORTE,
  MARGEM_MINIMA_CORTE,
  MESES_SIMULACAO_MAX,
  MULTIPLICADOR_RESERVA,
  PROPORCAO_APORTE,
  RITMO_PADRAO,
  TAXAS_PADRAO,
  TAXA_LIVRE_RISCO_ANUAL,
  proporcaoAporte,
} from "./config";
import { entradasDoDecimo, primeiroMesDoDecimo, valorDoDecimoTerceiro, type EntradaExtra } from "./decimo-terceiro";
import { guardadoNaMetaEfetivo } from "./guardado-meta";
import { RITMOS } from "./schema";
import { textos } from "./textos";
import type {
  Alocacao,
  DecimoTerceiroNoPlano,
  Degrau,
  Destino,
  DiagnosticoDividaCara,
  Divida,
  DividaAvaliada,
  Folego,
  GastoFixo,
  GastoFixoDetalhado,
  MotivoSemQuitacao,
  Perfil,
  PisoAporte,
  Plano,
  PlanoDeCorte,
  QuadroDividas,
  Reserva,
  Resumo,
  Ritmo,
} from "./types";
import { arredondar } from "./format";

/*
  O motor do dindin. Funções puras: perfil entra, plano sai.
  Nada aqui toca rede, storage ou React — é o que permite testar e reaproveitar
  nas calculadoras públicas.

  A cascata, na ordem:
    00 fôlego mínimo → 01 dívida cara → 02 reserva → 03 dívida média → 04 metas
  Um degrau só recebe dinheiro quando o anterior está satisfeito.

  As projeções ("nesse ritmo, zera em X meses") seguem o caminho da cascata,
  não só o mês atual: se hoje o aporte vai pro fôlego, a dívida é projetada
  com o ritmo que ela vai receber quando o fôlego fechar.
*/

export interface OpcoesMotor {
  /** sobrescreve a taxa livre de risco (Selic/CDI) usada pra classificar dívidas */
  taxaLivreRisco?: number;
  /**
   * Valor que a pessoa decidiu guardar por mês, no lugar do que o ritmo sugere
   * — é o que acontece quando ela edita o grupo "Guardar" na tela.
   *
   * Entra pelo MESMO acessor que o ritmo (aportePorDegrau), nunca num cálculo
   * paralelo: é isso que mantém o aporte do mês e as projeções falando o mesmo
   * número. Limitado só ao EXCEDENTE: o piso livre protege a SUGESTÃO do
   * ritmo, não a escolha da pessoa — à mão ela pode guardar até 100% do que
   * sobra ("liberdade total com o dinheiro dela"). Um valor gravado acima do
   * excedente (a sobra diminuiu) entra no excedente — a tela nunca precisa
   * corrigir o que o motor devolve.
   */
  aporteEscolhido?: number;
  /**
   * A data de hoje, pra saber quando cai o próximo 13º. Sem ela o 13º não entra
   * nos prazos (o plano continua determinístico e igual ao de antes); a tela
   * do plano sempre passa.
   */
  hoje?: Date;
}

/**
 * Quanto extra entra por mês numa simulação de quitação. Um número é ritmo
 * constante; um cronograma descreve meses iniciais diferentes (ex.: zero
 * enquanto o fôlego é montado) e a partir de qual mês o ritmo fica constante.
 */
export type Cronograma =
  | number
  | {
      extra: (mes: number) => number;
      /** a partir deste mês `extra` não muda mais */
      regimeAPartirDe: number;
      /**
       * de quantos em quantos meses o `extra` se repete no regime; ausente = 1
       * (constante). Com o 13º é 12: um mês sem ele pode não vencer os juros e
       * o ano inteiro vencer — a trava dos juros compara um ano com o outro.
       */
      ciclo?: number;
    };

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** 0.45 a.a. → taxa mensal equivalente (juros compostos) */
export function taxaMensal(taxaAnual: number): number {
  return (1 + taxaAnual) ** (1 / 12) - 1;
}

/**
 * Classifica cada dívida pela taxa e devolve ordenadas da mais cara pra mais barata.
 * Cara: acima do limiar E acima da taxa livre de risco (se a Selic passar do
 * limiar, uma dívida abaixo dela não é cara — rende mais deixar guardado).
 * Dívidas com saldo zero são ignoradas.
 *
 * A parcela nunca passa do saldo: ninguém paga por mês mais do que deve no
 * total. O schema já recusa isso no onboarding; aqui é a defesa pra quem chama
 * o motor sem validar (backend, calculadoras) — senão a parcela cheia entraria
 * no custo de todo mês.
 */
export function avaliarDividas(
  dividas: Divida[],
  taxaLivreRisco: number = TAXA_LIVRE_RISCO_ANUAL,
): DividaAvaliada[] {
  return dividas
    .filter((d) => d.saldo > 0)
    .map<DividaAvaliada>((d) => {
      const taxaAnual = d.taxaAnual ?? TAXAS_PADRAO[d.tipo];
      const acimaDaLivre = taxaAnual > taxaLivreRisco;
      const classe = !acimaDaLivre ? "barata" : taxaAnual > LIMIAR_DIVIDA_CARA ? "cara" : "media";
      return {
        ...d,
        ...(d.parcela !== undefined && { parcela: Math.min(d.parcela, d.saldo) }),
        taxaAnual,
        classe,
        jurosMensais: arredondar(d.saldo * taxaMensal(taxaAnual)),
      };
    })
    .sort((a, b) => b.taxaAnual - a.taxaAnual);
}

/**
 * O resultado de uma simulação de quitação, com o motivo quando não há prazo.
 * Dois motivos diferentes viram frases diferentes: "os juros crescem mais
 * rápido do que você paga" é falso quando a dívida cai, só que devagar demais.
 */
export interface ResultadoQuitacao {
  /** meses até zerar tudo; null quando não zera */
  meses: number | null;
  /** por que não zerou; null quando zerou */
  motivo: MotivoSemQuitacao | null;
}

/**
 * Quantos meses até zerar TODAS as dívidas da lista, pagando as parcelas
 * informadas + o extra do cronograma na mais cara primeiro. Quando uma dívida
 * zera, a parcela dela (e a sobra da parcela no mês em que zerou) reforça as
 * outras — efeito bola de neve.
 * Devolve null quando, já no ritmo de regime, o total não cai: os juros
 * superam o pagamento.
 *
 * Contrato antigo, mantido: o backend e o index exportam esta assinatura. Quem
 * precisa saber POR QUE não houve prazo chama `simularQuitacaoDetalhada`.
 */
export function simularQuitacao(dividas: DividaAvaliada[], cronograma: Cronograma): number | null {
  return simularQuitacaoDetalhada(dividas, cronograma).meses;
}

/** A mesma simulação, dizendo se travou nos juros ou no horizonte de simulação. */
export function simularQuitacaoDetalhada(
  dividas: DividaAvaliada[],
  cronograma: Cronograma,
): ResultadoQuitacao {
  const { meses, motivo } = simularComSobra(dividas, cronograma);
  return { meses, motivo };
}

/** A simulação com o que sobrou do dinheiro no mês em que tudo zerou (o 13º que passou da dívida). */
interface QuitacaoComSobra extends ResultadoQuitacao {
  /** o que sobrou do pagamento no mês em que zerou; 0 quando não zerou */
  sobra: number;
}

function simularComSobra(dividas: DividaAvaliada[], cronograma: Cronograma): QuitacaoComSobra {
  if (dividas.length === 0) return { meses: 0, motivo: null, sobra: 0 };

  const extraDe =
    typeof cronograma === "number"
      ? () => Math.max(0, cronograma)
      : (mes: number) => Math.max(0, cronograma.extra(mes));
  const regimeAPartirDe = typeof cronograma === "number" ? 1 : cronograma.regimeAPartirDe;
  const ciclo = typeof cronograma === "number" ? 1 : Math.max(1, Math.trunc(cronograma.ciclo ?? 1));
  // total no fim de cada mês (índice 0 = antes do mês 1): a trava dos juros compara com `ciclo` meses atrás
  const historico: number[] = [];

  const saldos = dividas.map((d) => d.saldo);
  const taxas = dividas.map((d) => taxaMensal(d.taxaAnual));
  const parcelas = dividas.map((d) => Math.max(0, d.parcela ?? 0));
  const quitada = dividas.map(() => false);
  let reforco = 0; // parcelas liberadas por dívidas já quitadas

  for (let mes = 1; mes <= MESES_SIMULACAO_MAX; mes++) {
    const totalAntes = soma(saldos);
    if (mes === 1) historico.push(totalAntes);
    let pool = extraDe(mes) + reforco;

    for (let i = 0; i < saldos.length; i++) {
      if (quitada[i]) continue;
      saldos[i] = saldos[i] * (1 + taxas[i]);
      const pago = Math.min(saldos[i], parcelas[i]);
      saldos[i] -= pago;
      pool += parcelas[i] - pago; // sobra da parcela no mês em que ela zera a dívida
    }

    for (let i = 0; i < saldos.length && pool > 0; i++) {
      if (quitada[i] || saldos[i] <= 0) continue;
      const pago = Math.min(saldos[i], pool);
      saldos[i] -= pago;
      pool -= pago;
    }

    for (let i = 0; i < saldos.length; i++) {
      if (!quitada[i] && saldos[i] <= 0.005) {
        quitada[i] = true;
        saldos[i] = 0;
        reforco += parcelas[i];
      }
    }

    if (quitada.every(Boolean)) return { meses: mes, motivo: null, sobra: Math.max(0, pool) };

    const totalDepois = soma(saldos);
    historico.push(totalDepois);
    // saldo explodiu ou parou de cair no regime: o pagamento não vence os juros.
    // Com ciclo 1, historico[mes - 1] é o total do começo deste mês (o de sempre)
    if (!Number.isFinite(totalDepois)) return { meses: null, motivo: "juros", sobra: 0 };
    if (mes >= regimeAPartirDe + ciclo - 1 && totalDepois >= historico[mes - ciclo]) {
      return { meses: null, motivo: "juros", sobra: 0 };
    }
  }

  // aqui o saldo cai todo mês — só não cabe em MESES_SIMULACAO_MAX
  return { meses: null, motivo: "horizonte", sobra: 0 };
}

/**
 * Resolve nome e ícone de cada gasto e ordena do maior pro menor — é assim
 * que a tela mostra e é assim que o plano de corte escolhe por onde começar.
 */
export function detalharGastos(gastos: GastoFixo[]): GastoFixoDetalhado[] {
  const total = soma(gastos.map((g) => g.valor));
  return gastos
    .filter((g) => g.valor > 0)
    .map<GastoFixoDetalhado>((g) => {
      const cat = categoriaPorSlug(g.categoria);
      return {
        ...g,
        nomeExibido: g.nome?.trim() || cat?.nome || "Outro",
        icone: cat?.icone ?? ICONE_PADRAO,
        fatia: total > 0 ? arredondar(g.valor / total, 4) : 0,
      };
    })
    .sort((a, b) => b.valor - a.valor);
}

/**
 * `beneficios` é a parte dos vales que paga gasto fixo (aplicarBeneficios): ela
 * soma do lado de quem entra, e o custo continua cheio. Assim o excedente é
 * dinheiro de verdade — o que sobra do salário depois do que o vale não pagou —
 * e a reserva segue medida pelo custo cheio.
 */
function montarResumo(perfil: Perfil, custoFixo: number, parcelas: number, beneficios: number): Resumo {
  const custoTotal = arredondar(perfil.custoMoradia + custoFixo + parcelas);
  const excedente = arredondar(perfil.rendaMensal + beneficios - custoTotal);
  return {
    renda: perfil.rendaMensal,
    custoMoradia: perfil.custoMoradia,
    custoFixo,
    parcelas,
    custoTotal,
    beneficios,
    excedente,
    taxaExcedente: perfil.rendaMensal > 0 ? arredondar(excedente / perfil.rendaMensal, 4) : 0,
  };
}

function montarFolego(custoTotal: number, guardado: number): Folego {
  const alvo = arredondar(Math.min(FOLEGO_TETO, Math.max(FOLEGO_PISO, custoTotal)));
  return {
    alvo,
    atual: arredondar(Math.min(guardado, alvo)),
    falta: arredondar(Math.max(0, alvo - guardado)),
    ok: guardado >= alvo,
    // o prazo sai da projeção do caminho (gerarPlano), que conhece o aporte e o 13º
    mesesParaCompletar: guardado >= alvo ? 0 : null,
  };
}

/** `guardado` aqui é o que sobra do guardado depois da parte que foi pra meta. */
function montarReserva(perfil: Perfil, custoTotal: number, folegoAlvo: number, guardado: number): Reserva {
  const multiplicador = MULTIPLICADOR_RESERVA[perfil.tipoRenda];
  const alvo = arredondar(Math.max(multiplicador * custoTotal, folegoAlvo));
  return {
    multiplicador,
    alvo,
    atual: arredondar(Math.min(guardado, alvo)),
    falta: arredondar(Math.max(0, alvo - guardado)),
    ok: guardado >= alvo,
    mesesParaCompletar: guardado >= alvo ? 0 : null,
  };
}

function montarCorte(
  perfil: Perfil,
  resumo: Resumo,
  caras: DividaAvaliada[],
  gastos: GastoFixoDetalhado[],
): PlanoDeCorte {
  const deficit = arredondar(-resumo.excedente);
  const metaCorte = arredondar(deficit + perfil.rendaMensal * MARGEM_MINIMA_CORTE);
  const sugestoes: string[] = [];

  if (caras.length > 0) sugestoes.push(textos.corte.renegociar(caras[0]));
  if (perfil.custoMoradia > 0 && perfil.custoMoradia / perfil.rendaMensal > LIMIAR_MORADIA_PESADA) {
    // gastos chega ordenado do maior pro menor
    const maiorGasto = gastos[0]?.valor ?? 0;
    sugestoes.push(textos.corte.moradiaPesada(perfil.custoMoradia, perfil.rendaMensal, maiorGasto));
  }
  // com os gastos separados dá pra dizer ONDE cortar; sem eles, só o conselho genérico
  const maiores = gastos.slice(0, MAIORES_GASTOS_NO_CORTE);
  sugestoes.push(maiores.length > 0 ? textos.corte.maioresGastos(maiores) : textos.corte.assinaturas());
  sugestoes.push(textos.corte.rendaExtra(metaCorte));

  return {
    deficit,
    metaCorte,
    metaTexto: textos.corte.meta(metaCorte, perfil.rendaMensal, deficit),
    sugestoes,
  };
}

function decidirDegrau(
  folego: Folego,
  caras: DividaAvaliada[],
  reserva: Reserva,
  medias: DividaAvaliada[],
): Degrau {
  if (!folego.ok) return 0;
  if (caras.length > 0) return 1;
  if (!reserva.ok) return 2;
  if (medias.length > 0) return 3;
  return 4;
}

/**
 * Distribui o aporte do mês pela cascata. Devolve as alocações e quanto
 * ficou em cada degrau.
 */
function alocar(
  aporte: number,
  folego: Folego,
  reserva: Reserva,
  caras: DividaAvaliada[],
  medias: DividaAvaliada[],
  perfil: Perfil,
): { alocacoes: Alocacao[]; porDestino: Record<Alocacao["destino"], number> } {
  const porDestino: Record<Alocacao["destino"], number> = {
    folego: 0,
    divida_cara: 0,
    reserva: 0,
    divida_media: 0,
    metas: 0,
  };
  const alocacoes: Alocacao[] = [];
  let restante = aporte;

  if (!folego.ok && restante > 0) {
    const valor = arredondar(Math.min(restante, folego.falta));
    porDestino.folego = valor;
    alocacoes.push({ destino: "folego", valor, ...textos.alocacao.folego(folego) });
    restante = arredondar(restante - valor);
  }

  if (caras.length > 0 && restante > 0) {
    porDestino.divida_cara = restante;
    alocacoes.push({
      destino: "divida_cara",
      valor: restante,
      ...textos.alocacao.dividaCara(caras),
    });
    restante = 0;
  }

  // o fôlego é parte da reserva: o que foi pra lá já conta
  const faltaReserva = arredondar(Math.max(0, reserva.falta - porDestino.folego));
  if (faltaReserva > 0 && restante > 0) {
    const valor = arredondar(Math.min(restante, faltaReserva));
    porDestino.reserva = valor;
    alocacoes.push({ destino: "reserva", valor, ...textos.alocacao.reserva(reserva) });
    restante = arredondar(restante - valor);
  }

  if (medias.length > 0 && restante > 0) {
    porDestino.divida_media = restante;
    alocacoes.push({
      destino: "divida_media",
      valor: restante,
      ...textos.alocacao.dividaMedia(medias),
    });
    restante = 0;
  }

  if (restante > 0) {
    porDestino.metas = restante;
    alocacoes.push({ destino: "metas", valor: restante, ...textos.alocacao.metas(perfil.meta) });
  }

  return { alocacoes, porDestino };
}

/** Quanto vai pra cascata num degrau, e de onde esse número saiu. */
interface AporteDoDegrau extends PisoAporte {
  /** o aporte efetivo, já arredondado ao centavo */
  valor: number;
}

/**
 * O ÚNICO lugar que decide quanto a pessoa guarda. Fecha o ritmo e a renda numa
 * função só: o aporte deste mês e as projeções ("zera em X meses") chamam a
 * mesma coisa, então o plano não consegue dizer "guarde 300" e projetar com 500.
 *
 * O piso: o acelerado nunca deixa a pessoa com menos de MARGEM_MINIMA_CORTE da
 * renda livre — um plano que zera o lazer é abandonado em duas semanas, e
 * abaixo dessa margem o próprio produto diz que nem existe plano. E o piso
 * nunca empurra ninguém pra BAIXO do equilibrado: por isso o teto é o maior
 * entre "o que sobra respeitando a margem" e "o que o equilibrado guardaria".
 *
 * O piso é da RECOMENDAÇÃO: nenhum ritmo sugere deixar a pessoa sem nada. O
 * valor escolhido à mão não passa por ele, só pelo excedente (nunca guarda
 * mais do que sobra): quem quer chegar mais rápido pode guardar 100%.
 */
function aportePorDegrau(
  excedente: number,
  renda: number,
  ritmo: Ritmo | undefined,
  aporteEscolhido?: number,
) {
  // escolha da pessoa vale em todos os degraus: ela decidiu um valor por mês,
  // não uma fração de urgência. Só o excedente limita: o piso é da sugestão
  const escolhido =
    aporteEscolhido === undefined || !Number.isFinite(aporteEscolhido)
      ? null
      : Math.max(0, aporteEscolhido);

  return (degrau: Degrau): AporteDoDegrau => {
    const sugerido = excedente * proporcaoAporte(ritmo, degrau);
    const tetoPeloLivre = Math.max(0, excedente - renda * MARGEM_MINIMA_CORTE);
    const teto = Math.max(tetoPeloLivre, excedente * PROPORCAO_APORTE.equilibrado[degrau]);
    return {
      valor: arredondar(escolhido === null ? Math.min(sugerido, teto) : Math.min(escolhido, Math.max(0, excedente))),
      sugerido: arredondar(sugerido),
      teto: arredondar(teto),
      mordeu: escolhido === null && teto < sugerido,
    };
  };
}

type AporteDe = (degrau: Degrau) => AporteDoDegrau;

/**
 * O aporte em reais inteiros, arredondado pra baixo. A tela mostra dinheiro sem
 * centavos: com o aporte em 577,50 e o livre em 1.072,50, os dois viravam
 * R$ 578 + R$ 1.073 — um real a mais do que sobra. Com o aporte inteiro, o
 * livre (excedente − aporte) arredonda junto com o excedente e a soma fecha.
 * Pra baixo porque o aporte nunca pode passar do excedente.
 *
 * Embrulha o acessor em vez de mexer nele: o aporte do mês e as projeções
 * continuam saindo da mesma função. Sugerido e teto descem junto, senão a tela
 * diria "o plano sugeria R$ 578" ao lado de um plano que guarda 577.
 */
function emReaisInteiros(aporteDe: AporteDe): AporteDe {
  // a folga cobre o erro de ponto flutuante: 419,99999999 é 420, não 419
  const reais = (v: number) => Math.max(0, Math.floor(v + 1e-6));
  return (degrau) => {
    const a = aporteDe(degrau);
    const sugerido = reais(a.sugerido);
    const teto = reais(a.teto);
    // o piso só "mordeu" se a diferença sobreviveu ao arredondamento
    return { valor: reais(a.valor), sugerido, teto, mordeu: a.mordeu && teto < sugerido };
  };
}

interface Projecoes {
  /** meses até o fôlego fechar; 0 quando já fechou ou quando nada entra (ver mesesAteOFolego) */
  mesesFolego: number;
  mesesParaQuitarCaras: number | null;
  /** por que as caras não têm prazo; null quando têm (ou quando não há caras) */
  motivoCaras: MotivoSemQuitacao | null;
  mesesParaCompletarReserva: number | null;
  mesesParaQuitarMedias: number | null;
  /** o que sobra do 13º no mês em que o último passo antes da meta fecha; 0 sem 13º */
  sobraDoExtraNoFim: number;
}

/**
 * Meses até o fôlego fechar com o aporte do degrau 0. Com aporte zero (a pessoa
 * zerou o "Guardar") o fôlego nunca fecha, mas também não há nada esperando por
 * ele: as dívidas seguem só com as parcelas desde o primeiro mês. Contar 0 aqui
 * é o que deixa a simulação rodar em vez de dividir por zero.
 *
 * Com o 13º (`extra`), soma mês a mês: ele pode fechar o fôlego sozinho, até
 * com o Guardar em 0%. Sem ele, a conta de sempre.
 */
function mesesAteOFolego(folego: Folego, aporte0: number, extra: EntradaExtra | null = null): number {
  if (folego.ok) return 0;
  if (extra === null) {
    if (aporte0 <= 0) return 0;
    return Math.ceil(folego.falta / aporte0);
  }
  let juntou = 0;
  for (let mes = 1; mes <= MESES_SIMULACAO_MAX; mes++) {
    juntou += Math.max(0, aporte0) + extra(mes);
    // a folga cobre o erro de ponto flutuante, como em emReaisInteiros
    if (juntou + 1e-6 >= folego.falta) return mes;
  }
  return 0;
}

/**
 * O que o plano juntou até o fim de cada mês enquanto o fôlego era montado, com
 * o 13º: `[0, mês 1, mês 2…]` até `mesesFolego`. É o que decide quanto passou
 * do fôlego (e foi pra dívida cara, ou já é reserva).
 */
function juntadoNoFolego(aporte0: number, mesesFolego: number, extra: EntradaExtra): number[] {
  const juntado = [0];
  for (let mes = 1; mes <= mesesFolego; mes++) juntado.push(juntado[mes - 1] + Math.max(0, aporte0) + extra(mes));
  return juntado;
}

/**
 * Prazo das dívidas caras num ritmo qualquer, seguindo o caminho da cascata:
 * enquanto o fôlego não fecha, a dívida recebe só a sobra.
 *
 * Está separado de projetarCaminho porque os textos precisam rodar a mesma
 * conta nos outros ritmos pra responder "e se eu acelerasse?" — sem isso o
 * plano afirma que renegociar é o único caminho quando não é.
 *
 * Com o 13º, ele entra no mês em que cai: primeiro no fôlego (se ainda falta),
 * o resto na dívida. A trava dos juros passa a olhar um ano inteiro (`ciclo`).
 */
function projetarCaras(
  aporteDe: AporteDe,
  folego: Folego,
  caras: DividaAvaliada[],
  extra: EntradaExtra | null = null,
): QuitacaoComSobra {
  const aporte0 = aporteDe(0).valor;
  const mesesFolego = mesesAteOFolego(folego, aporte0, extra);
  if (extra === null) {
    const extraCaras = (mes: number): number => {
      if (mes > mesesFolego) return aporteDe(1).valor;
      const antes = Math.max(0, (mes - 1) * aporte0 - folego.falta);
      const depois = Math.max(0, mes * aporte0 - folego.falta);
      return arredondar(depois - antes);
    };
    return simularComSobra(caras, { extra: extraCaras, regimeAPartirDe: mesesFolego + 1 });
  }
  const juntado = juntadoNoFolego(aporte0, mesesFolego, extra);
  const extraCaras = (mes: number): number => {
    if (mes > mesesFolego) return aporteDe(1).valor + extra(mes);
    const antes = Math.max(0, juntado[mes - 1] - folego.falta);
    const depois = Math.max(0, juntado[mes] - folego.falta);
    return arredondar(depois - antes);
  };
  return simularComSobra(caras, { extra: extraCaras, regimeAPartirDe: mesesFolego + 1, ciclo: 12 });
}

/**
 * A parte do 13º que sobrou no mês em que um passo fechou — o resto da sobra
 * é o aporte do mês, que a projeção de sempre não carrega (ela começa o passo
 * seguinte no mês seguinte). Sem carregar o 13º, R$ 2.500 que quitam os
 * últimos R$ 500 do cartão sumiriam da conta.
 */
function sobraDoExtra(sobra: number, extra: EntradaExtra | null, mes: number | null): number {
  if (extra === null || mes === null || mes <= 0) return 0;
  return arredondar(Math.max(0, Math.min(sobra, extra(mes))));
}

/**
 * Projeta o caminho pela cascata, mês a mês, assumindo que a pessoa segue o
 * plano: o aporte de cada degrau é o mesmo que o plano manda guardar hoje.
 * Todos os prazos contam a partir deste mês (o mês atual é o mês 1).
 *
 * `aporteDepoisDasCaras` é o mesmo acessor, só que sobre o excedente com as
 * parcelas das dívidas caras de volta: quando elas zeram, a parcela sai do
 * orçamento e vira sobra. Sem isso a reserva era projetada pra sempre com a
 * sobra apertada de hoje — "4 anos" pra algo que fecha em pouco mais de um.
 *
 * Com aporte zero (o "Guardar" zerado) as dívidas continuam sendo projetadas:
 * a parcela sozinha pode quitar, e dizer que não quita seria mentir.
 *
 * `extra` é o 13º (decimo-terceiro.ts): cai inteiro no passo da vez, e o que
 * passar dele segue pro passo seguinte no mesmo mês. null = a conta de sempre,
 * sem nenhuma diferença.
 */
function projetarCaminho(
  aporteDe: AporteDe,
  aporteDepoisDasCaras: AporteDe,
  excedente: number,
  folego: Folego,
  reserva: Reserva,
  caras: DividaAvaliada[],
  medias: DividaAvaliada[],
  extra: EntradaExtra | null = null,
): Projecoes {
  const nada: Projecoes = {
    mesesFolego: 0,
    mesesParaQuitarCaras: null,
    motivoCaras: null,
    mesesParaCompletarReserva: reserva.ok ? 0 : null,
    mesesParaQuitarMedias: null,
    sobraDoExtraNoFim: 0,
  };
  if (excedente <= 0) return nada;

  const temCaras = caras.length > 0;
  const aporte0 = aporteDe(0).valor;
  // da reserva em diante as caras já zeraram (a reserva espera por elas)
  const aporteDaqui = (d: Degrau) => (temCaras ? aporteDepoisDasCaras : aporteDe)(d).valor;

  // 00 — meses até o fôlego fechar, no ritmo do degrau 0
  const mesesFolego = mesesAteOFolego(folego, aporte0, extra);

  // 01 — a dívida cara recebe só a sobra do fôlego enquanto ele é montado, depois o ritmo pleno
  const quitacaoCaras: QuitacaoComSobra = temCaras
    ? projetarCaras(aporteDe, folego, caras, extra)
    : { meses: null, motivo: null, sobra: 0 };
  const mesesParaQuitarCaras = quitacaoCaras.meses;
  const sobraCaras = sobraDoExtra(quitacaoCaras.sobra, extra, mesesParaQuitarCaras);

  /*
    A reserva com o 13º, mês a mês. Até `inicio`: com dívida cara, só o fôlego
    entrou na reserva (mais a sobra do 13º no mês em que as caras zeraram); sem,
    tudo o que foi juntado — o fôlego é parte da reserva.
  */
  const completarReserva = (inicio: number, porMes: EntradaExtra): { meses: number; sobra: number } | null => {
    const juntado = temCaras ? folego.falta + sobraCaras : juntadoNoFolego(aporte0, inicio, porMes)[inicio];
    if (juntado + 1e-6 >= reserva.falta) {
      const passou = juntado - reserva.falta;
      return {
        meses: inicio,
        sobra: temCaras ? arredondar(Math.max(0, Math.min(passou, sobraCaras))) : sobraDoExtra(passou, porMes, inicio),
      };
    }
    const falta = reserva.falta - juntado;
    const aporte2 = aporteDaqui(2);
    let depois = 0;
    for (let mes = inicio + 1; mes <= MESES_SIMULACAO_MAX; mes++) {
      depois += Math.max(0, aporte2) + porMes(mes);
      if (depois + 1e-6 >= falta) return { meses: mes, sobra: sobraDoExtra(depois - falta, porMes, mes) };
    }
    return null;
  };

  // 02 — a reserva começa a receber em ritmo pleno depois do fôlego e das dívidas caras
  let mesesParaCompletarReserva: number | null;
  let sobraReserva = 0;
  if (reserva.ok) {
    mesesParaCompletarReserva = 0;
  } else if (extra === null) {
    const inicio = temCaras ? mesesParaQuitarCaras : mesesFolego;
    const aporte2 = aporteDaqui(2);
    if (inicio === null || aporte2 <= 0) {
      mesesParaCompletarReserva = null;
    } else {
      // até `inicio`: com dívida cara só o fôlego entrou na reserva; sem, tudo que foi aportado
      const jaEntrou = temCaras ? folego.falta : Math.min(reserva.falta, inicio * aporte0);
      const faltaDepois = Math.max(0, reserva.falta - jaEntrou);
      mesesParaCompletarReserva = inicio + (faltaDepois > 0 ? Math.ceil(faltaDepois / aporte2) : 0);
    }
  } else {
    const inicio = temCaras ? mesesParaQuitarCaras : mesesFolego;
    const comExtra = inicio === null ? null : completarReserva(inicio, extra);
    mesesParaCompletarReserva = comExtra?.meses ?? null;
    sobraReserva = comExtra?.sobra ?? 0;
  }

  // 03 — a dívida média espera a reserva fechar
  let mesesParaQuitarMedias: number | null = null;
  let sobraMedias = 0;
  if (medias.length > 0 && mesesParaCompletarReserva !== null) {
    const inicio = mesesParaCompletarReserva;
    if (extra === null) {
      mesesParaQuitarMedias = simularQuitacao(medias, {
        extra: (mes) => (mes > inicio ? aporteDaqui(3) : 0),
        regimeAPartirDe: inicio + 1,
      });
    } else {
      // no mês em que a reserva fecha, o que sobrou do 13º já vai pra dívida
      const r = simularComSobra(medias, {
        extra: (mes) => (mes > inicio ? aporteDaqui(3) + extra(mes) : mes === inicio ? sobraReserva : 0),
        regimeAPartirDe: inicio + 1,
        ciclo: 12,
      });
      mesesParaQuitarMedias = r.meses;
      const doMes = r.meses === null ? 0 : r.meses > inicio ? extra(r.meses) : sobraReserva;
      sobraMedias = r.meses === null ? 0 : arredondar(Math.max(0, Math.min(r.sobra, doMes)));
    }
  }

  // o último passo antes da meta decide o que do 13º já chega nela
  const sobraDoExtraNoFim =
    medias.length > 0 ? sobraMedias : !reserva.ok ? sobraReserva : temCaras ? sobraCaras : 0;

  return {
    mesesFolego,
    mesesParaQuitarCaras,
    motivoCaras: quitacaoCaras.motivo,
    mesesParaCompletarReserva,
    mesesParaQuitarMedias,
    sobraDoExtraNoFim,
  };
}

/**
 * Quando as caras não têm prazo, procura o ritmo mais lento que resolve. A
 * ordem de RITMOS vai do mais leve pro mais rápido e o aporte cresce junto:
 * o primeiro que zera é o menor sacrifício que resolve.
 *
 * Só entra ritmo que guarda MAIS do que o plano de hoje — o texto apresenta a
 * saída como "uma fatia maior", e isso tem que ser verdade. Quando a pessoa
 * editou o "Guardar", o plano de hoje não é o do ritmo dela: aí o próprio
 * ritmo dela também é uma saída possível e entra na busca.
 */
function procurarRitmoQueResolve(
  excedente: number,
  renda: number,
  ritmoAtual: Ritmo,
  aporteEditado: boolean,
  aporteDeHoje: AporteDe,
  folego: Folego,
  caras: DividaAvaliada[],
  extra: EntradaExtra | null,
): { ritmo: Ritmo; meses: number } | null {
  const aporteHoje = aporteDeHoje(1).valor;
  for (const outro of RITMOS) {
    if (outro === ritmoAtual && !aporteEditado) continue;
    const aporteDe = emReaisInteiros(aportePorDegrau(excedente, renda, outro));
    if (aporteDe(0).valor <= 0 || aporteDe(1).valor <= aporteHoje) continue;
    const { meses } = projetarCaras(aporteDe, folego, caras, extra);
    if (meses !== null) return { ritmo: outro, meses };
  }
  return null;
}

/**
 * Quando nenhum ritmo zera as caras: e guardando TUDO o que sobra? Os ritmos
 * param no piso da sugestão, mas à mão a pessoa pode ir até 100% — e sem
 * essa conta o plano dizia "renegociar é o único caminho" pra uma dívida que
 * o próprio "Guardar" em 100% quita.
 *
 * Mesmo acessor de sempre (aportePorDegrau com a escolha = o excedente), então
 * o prazo é o mesmo que o plano mostraria se ela subisse o Guardar pra 100%.
 * null quando ela já guarda tudo (não há "mais" pra oferecer) ou quando nem
 * assim zera.
 */
function projetarGuardandoTudo(
  excedente: number,
  renda: number,
  ritmo: Ritmo,
  aporteDeHoje: AporteDe,
  folego: Folego,
  caras: DividaAvaliada[],
  extra: EntradaExtra | null,
): { valor: number; meses: number } | null {
  const tudo = emReaisInteiros(aportePorDegrau(excedente, renda, ritmo, excedente));
  const valor = tudo(1).valor;
  if (valor <= 0 || valor <= aporteDeHoje(1).valor) return null;
  const { meses } = projetarCaras(tudo, folego, caras, extra);
  return meses === null ? null : { valor, meses };
}

/**
 * Em que passo o próximo 13º cai: o que estiver em aberto no começo daquele
 * mês. Os prazos são acumulados (contam deste mês), então basta compará-los.
 */
function destinoDoDecimo(
  mes: number,
  folego: Folego,
  reserva: Reserva,
  caras: DividaAvaliada[],
  medias: DividaAvaliada[],
  projecoes: Projecoes,
): Destino {
  const aberto = (meses: number | null) => meses === null || mes <= meses;
  if (!folego.ok && aberto(projecoes.mesesFolego)) return "folego";
  if (caras.length > 0 && aberto(projecoes.mesesParaQuitarCaras)) return "divida_cara";
  if (!reserva.ok && aberto(projecoes.mesesParaCompletarReserva)) return "reserva";
  if (medias.length > 0 && aberto(projecoes.mesesParaQuitarMedias)) return "divida_media";
  return "metas";
}

/** Perfil entra, plano sai. Determinístico (a data, quando entra, vem em `opcoes.hoje`). */
export function gerarPlano(perfil: Perfil, opcoes: OpcoesMotor = {}): Plano {
  const taxaLivre = opcoes.taxaLivreRisco ?? TAXA_LIVRE_RISCO_ANUAL;

  const avaliadas = avaliarDividas(perfil.dividas, taxaLivre);
  const caras = avaliadas.filter((d) => d.classe === "cara");
  const medias = avaliadas.filter((d) => d.classe === "media");
  const baratas = avaliadas.filter((d) => d.classe === "barata");
  const parcelas = arredondar(soma(avaliadas.map((d) => d.parcela ?? 0)));

  const gastosFixos = detalharGastos(perfil.gastosFixos);
  const custoFixo = arredondar(soma(gastosFixos.map((g) => g.valor)));

  // o vale entra só até o valor dos gastos que ele paga: o resto fica no cartão
  const beneficios = aplicarBeneficios(perfil.beneficios, perfil.gastosFixos);
  const resumo = montarResumo(perfil, custoFixo, parcelas, beneficios.pagaGastos);
  // o que já foi separado pra meta não é reserva: o mesmo real não conta duas vezes
  const guardadoNaMeta = guardadoNaMetaEfetivo(perfil);
  const guardadoLivre = arredondar(Math.max(0, perfil.guardado - guardadoNaMeta));
  const folego = montarFolego(resumo.custoTotal, guardadoLivre);
  const reserva = montarReserva(perfil, resumo.custoTotal, folego.alvo, guardadoLivre);
  const degrau = decidirDegrau(folego, caras, reserva, medias);
  const modoCorte = resumo.excedente <= 0;

  const ritmo = perfil.ritmo ?? RITMO_PADRAO;
  const aporteEscolhido = opcoes.aporteEscolhido ?? perfil.aporteEscolhido;
  const aporteEditado = aporteEscolhido !== undefined && Number.isFinite(aporteEscolhido);
  const aporteDe = emReaisInteiros(
    aportePorDegrau(resumo.excedente, perfil.rendaMensal, ritmo, aporteEscolhido),
  );
  // quando as caras zeram, as parcelas delas voltam pra sobra (ver projetarCaminho)
  const parcelasCaras = soma(caras.map((d) => d.parcela ?? 0));
  const aporteDepoisDasCaras =
    parcelasCaras > 0
      ? emReaisInteiros(
          aportePorDegrau(
            arredondar(resumo.excedente + parcelasCaras),
            perfil.rendaMensal,
            ritmo,
            aporteEscolhido,
          ),
        )
      : aporteDe;
  const doMes = aporteDe(degrau);
  const aporte = modoCorte ? 0 : doMes.valor;
  const piso: PisoAporte = modoCorte
    ? { sugerido: 0, teto: 0, mordeu: false }
    : { sugerido: doMes.sugerido, teto: doMes.teto, mordeu: doMes.mordeu };
  const livre = modoCorte ? 0 : arredondar(resumo.excedente - aporte);

  const { alocacoes } = alocar(aporte, folego, reserva, caras, medias, perfil);

  // o 13º: fora do mês a mês, dentro dos prazos (decimo-terceiro.ts). Sem data, sem 13º nos prazos
  const valorDecimo = valorDoDecimoTerceiro(perfil);
  const primeiroMesDecimo = opcoes.hoje ? primeiroMesDoDecimo(opcoes.hoje) : null;
  const extra = modoCorte ? null : entradasDoDecimo({ valor: valorDecimo, primeiroMes: primeiroMesDecimo });

  const projecoes = projetarCaminho(
    aporteDe,
    aporteDepoisDasCaras,
    resumo.excedente,
    folego,
    reserva,
    caras,
    medias,
    extra,
  );
  reserva.mesesParaCompletar = projecoes.mesesParaCompletarReserva;
  // sem aporte e sem 13º o fôlego não fecha (null); o caminho e o cartão do topo leem daqui
  if (!folego.ok) {
    folego.mesesParaCompletar =
      !modoCorte && (aporteDe(0).valor > 0 || extra !== null) ? projecoes.mesesFolego : null;
  }

  const decimoTerceiro: DecimoTerceiroNoPlano | null =
    valorDecimo > 0
      ? {
          valor: valorDecimo,
          primeiroMes: primeiroMesDecimo,
          destino:
            primeiroMesDecimo === null || modoCorte
              ? null
              : destinoDoDecimo(primeiroMesDecimo, folego, reserva, caras, medias, projecoes),
          sobraParaAMeta: projecoes.sobraDoExtraNoFim,
        }
      : null;

  // "renegociar é o único caminho" só vale quando nenhum ritmo resolve E nem
  // guardar tudo o que sobra resolve. Em modo corte não há ritmo que resolva
  // nada: o problema é o custo fixo, e quem fala é o plano de corte.
  let diagnosticoCaras: DiagnosticoDividaCara | null = null;
  if (!modoCorte && caras.length > 0 && projecoes.mesesParaQuitarCaras === null) {
    const saida = procurarRitmoQueResolve(
      resumo.excedente,
      perfil.rendaMensal,
      ritmo,
      aporteEditado,
      aporteDe,
      folego,
      caras,
      extra,
    );
    diagnosticoCaras = {
      motivo: projecoes.motivoCaras ?? "juros",
      ritmoQueResolve: saida?.ritmo ?? null,
      mesesNoRitmoQueResolve: saida?.meses ?? null,
      guardandoTudo: saida
        ? null
        : projetarGuardandoTudo(resumo.excedente, perfil.rendaMensal, ritmo, aporteDe, folego, caras, extra),
    };
  }

  const dividas: QuadroDividas = {
    avaliadas,
    caras,
    medias,
    baratas,
    totalCaras: arredondar(soma(caras.map((d) => d.saldo))),
    totalMedias: arredondar(soma(medias.map((d) => d.saldo))),
    jurosMensaisCaras: arredondar(soma(caras.map((d) => d.jurosMensais))),
    mesesParaQuitarCaras: projecoes.mesesParaQuitarCaras,
    mesesParaQuitarMedias: projecoes.mesesParaQuitarMedias,
  };

  const corte = modoCorte ? montarCorte(perfil, resumo, caras, gastosFixos) : null;

  const contexto = {
    perfil,
    resumo,
    degrau,
    ritmo,
    folego,
    reserva,
    dividas,
    diagnosticoCaras,
    corte,
    aporte,
    aporteEditado,
    livre,
  };

  return {
    perfil,
    resumo,
    beneficios,
    gastosFixos,
    modoCorte,
    corte,
    degrau,
    decisao: textos.decisao(contexto),
    ritmo,
    aporte,
    piso,
    livre,
    alocacoes,
    folego,
    reserva,
    guardadoNaMeta,
    decimoTerceiro,
    dividas,
    diagnosticoCaras,
    proximosPassos: textos.proximosPassos(contexto),
  };
}
