/*
  GERADO a partir de dindinFrontend/src/domain/motor.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

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
  TAXAS_PADRAO,
  TAXA_LIVRE_RISCO_ANUAL,
} from "./config";
import { textos } from "./textos";
import type {
  Alocacao,
  Degrau,
  Divida,
  DividaAvaliada,
  Folego,
  GastoFixo,
  GastoFixoDetalhado,
  Perfil,
  Plano,
  PlanoDeCorte,
  QuadroDividas,
  Reserva,
  Resumo,
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
        taxaAnual,
        classe,
        jurosMensais: arredondar(d.saldo * taxaMensal(taxaAnual)),
      };
    })
    .sort((a, b) => b.taxaAnual - a.taxaAnual);
}

/**
 * Quantos meses até zerar TODAS as dívidas da lista, pagando as parcelas
 * informadas + o extra do cronograma na mais cara primeiro. Quando uma dívida
 * zera, a parcela dela (e a sobra da parcela no mês em que zerou) reforça as
 * outras — efeito bola de neve.
 * Devolve null quando, já no ritmo de regime, o total não cai: os juros
 * superam o pagamento.
 */
export function simularQuitacao(dividas: DividaAvaliada[], cronograma: Cronograma): number | null {
  if (dividas.length === 0) return 0;

  const extraDe =
    typeof cronograma === "number"
      ? () => Math.max(0, cronograma)
      : (mes: number) => Math.max(0, cronograma.extra(mes));
  const regimeAPartirDe = typeof cronograma === "number" ? 1 : cronograma.regimeAPartirDe;

  const saldos = dividas.map((d) => d.saldo);
  const taxas = dividas.map((d) => taxaMensal(d.taxaAnual));
  const parcelas = dividas.map((d) => Math.max(0, d.parcela ?? 0));
  const quitada = dividas.map(() => false);
  let reforco = 0; // parcelas liberadas por dívidas já quitadas

  for (let mes = 1; mes <= MESES_SIMULACAO_MAX; mes++) {
    const totalAntes = soma(saldos);
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

    if (quitada.every(Boolean)) return mes;

    const totalDepois = soma(saldos);
    if (!Number.isFinite(totalDepois)) return null;
    if (mes >= regimeAPartirDe && totalDepois >= totalAntes) return null;
  }

  return null;
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

function montarResumo(perfil: Perfil, custoFixo: number, parcelas: number): Resumo {
  const custoTotal = arredondar(perfil.custoMoradia + custoFixo + parcelas);
  const excedente = arredondar(perfil.rendaMensal - custoTotal);
  return {
    renda: perfil.rendaMensal,
    custoMoradia: perfil.custoMoradia,
    custoFixo,
    parcelas,
    custoTotal,
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
  };
}

function montarReserva(perfil: Perfil, custoTotal: number, folegoAlvo: number): Reserva {
  const multiplicador = MULTIPLICADOR_RESERVA[perfil.tipoRenda];
  const alvo = arredondar(Math.max(multiplicador * custoTotal, folegoAlvo));
  return {
    multiplicador,
    alvo,
    atual: arredondar(Math.min(perfil.guardado, alvo)),
    falta: arredondar(Math.max(0, alvo - perfil.guardado)),
    ok: perfil.guardado >= alvo,
    mesesParaCompletar: perfil.guardado >= alvo ? 0 : null,
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
    sugestoes.push(textos.corte.moradiaPesada(perfil.custoMoradia, perfil.rendaMensal));
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
    alocacoes.push({ destino: "metas", valor: restante, ...textos.alocacao.metas() });
  }

  return { alocacoes, porDestino };
}

interface Projecoes {
  mesesParaQuitarCaras: number | null;
  mesesParaCompletarReserva: number | null;
  mesesParaQuitarMedias: number | null;
}

/**
 * Projeta o caminho pela cascata, mês a mês, assumindo que a pessoa segue o
 * plano: o aporte de cada degrau é excedente × PROPORCAO_APORTE[degrau].
 * Todos os prazos contam a partir deste mês (o mês atual é o mês 1).
 */
function projetarCaminho(
  excedente: number,
  folego: Folego,
  reserva: Reserva,
  caras: DividaAvaliada[],
  medias: DividaAvaliada[],
): Projecoes {
  const nada: Projecoes = {
    mesesParaQuitarCaras: null,
    mesesParaCompletarReserva: reserva.ok ? 0 : null,
    mesesParaQuitarMedias: null,
  };
  if (excedente <= 0) return nada;

  const aporteNoDegrau = (d: Degrau) => arredondar(excedente * PROPORCAO_APORTE[d]);
  const aporte0 = aporteNoDegrau(0);
  if (aporte0 <= 0) return nada;

  // 00 — meses até o fôlego fechar, no ritmo do degrau 0
  const mesesFolego = folego.ok ? 0 : Math.ceil(folego.falta / aporte0);

  // 01 — a dívida cara recebe só a sobra do fôlego enquanto ele é montado, depois o ritmo pleno
  const extraCaras = (mes: number): number => {
    if (mes > mesesFolego) return aporteNoDegrau(1);
    const antes = Math.max(0, (mes - 1) * aporte0 - folego.falta);
    const depois = Math.max(0, mes * aporte0 - folego.falta);
    return arredondar(depois - antes);
  };
  const mesesParaQuitarCaras =
    caras.length > 0
      ? simularQuitacao(caras, { extra: extraCaras, regimeAPartirDe: mesesFolego + 1 })
      : null;

  // 02 — a reserva começa a receber em ritmo pleno depois do fôlego e das dívidas caras
  let mesesParaCompletarReserva: number | null;
  if (reserva.ok) {
    mesesParaCompletarReserva = 0;
  } else {
    const inicio = caras.length > 0 ? mesesParaQuitarCaras : mesesFolego;
    const aporte2 = aporteNoDegrau(2);
    if (inicio === null || aporte2 <= 0) {
      mesesParaCompletarReserva = null;
    } else {
      // até `inicio`: com dívida cara só o fôlego entrou na reserva; sem, tudo que foi aportado
      const jaEntrou = caras.length > 0 ? folego.falta : Math.min(reserva.falta, inicio * aporte0);
      const faltaDepois = Math.max(0, reserva.falta - jaEntrou);
      mesesParaCompletarReserva = inicio + (faltaDepois > 0 ? Math.ceil(faltaDepois / aporte2) : 0);
    }
  }

  // 03 — a dívida média espera a reserva fechar
  let mesesParaQuitarMedias: number | null = null;
  if (medias.length > 0 && mesesParaCompletarReserva !== null) {
    const inicio = mesesParaCompletarReserva;
    mesesParaQuitarMedias = simularQuitacao(medias, {
      extra: (mes) => (mes > inicio ? aporteNoDegrau(3) : 0),
      regimeAPartirDe: inicio + 1,
    });
  }

  return { mesesParaQuitarCaras, mesesParaCompletarReserva, mesesParaQuitarMedias };
}

/** Perfil entra, plano sai. Determinístico. */
export function gerarPlano(perfil: Perfil, opcoes: OpcoesMotor = {}): Plano {
  const taxaLivre = opcoes.taxaLivreRisco ?? TAXA_LIVRE_RISCO_ANUAL;

  const avaliadas = avaliarDividas(perfil.dividas, taxaLivre);
  const caras = avaliadas.filter((d) => d.classe === "cara");
  const medias = avaliadas.filter((d) => d.classe === "media");
  const baratas = avaliadas.filter((d) => d.classe === "barata");
  const parcelas = arredondar(soma(avaliadas.map((d) => d.parcela ?? 0)));

  const gastosFixos = detalharGastos(perfil.gastosFixos);
  const custoFixo = arredondar(soma(gastosFixos.map((g) => g.valor)));

  const resumo = montarResumo(perfil, custoFixo, parcelas);
  const folego = montarFolego(resumo.custoTotal, perfil.guardado);
  const reserva = montarReserva(perfil, resumo.custoTotal, folego.alvo);
  const degrau = decidirDegrau(folego, caras, reserva, medias);
  const modoCorte = resumo.excedente <= 0;

  const aporte = modoCorte ? 0 : arredondar(resumo.excedente * PROPORCAO_APORTE[degrau]);
  const livre = modoCorte ? 0 : arredondar(resumo.excedente - aporte);

  const { alocacoes } = alocar(aporte, folego, reserva, caras, medias);

  const projecoes = projetarCaminho(resumo.excedente, folego, reserva, caras, medias);
  reserva.mesesParaCompletar = projecoes.mesesParaCompletarReserva;

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

  const contexto = { perfil, resumo, degrau, folego, reserva, dividas, corte, aporte, livre };

  return {
    perfil,
    resumo,
    gastosFixos,
    modoCorte,
    corte,
    degrau,
    decisao: textos.decisao(contexto),
    aporte,
    livre,
    alocacoes,
    folego,
    reserva,
    dividas,
    proximosPassos: textos.proximosPassos(contexto),
  };
}
