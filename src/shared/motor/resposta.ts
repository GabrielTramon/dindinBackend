/*
  GERADO a partir de dindinFrontend/src/domain/resposta.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { MARGEM_MINIMA_CORTE, MAX_RENDIMENTO_MENSAL } from "./config";
import { outrosPotesQueCabem, pctDe, pctDoGuardar, repartirEmReaisInteiros, type SimulacaoRitmo } from "./divisor";
import { mesEstimado } from "./marcos";
import { rotuloMeta } from "./metas-catalogo";
import { projetarMeta, type Grupo, type ProjecaoMeta } from "./organizacao";
import { LIVRE_MINIMO, semPrazoCarasDoPlano, textos } from "./textos";
import type { DividaAvaliada, Meta, Plano, Ritmo, TipoDivida } from "./types";
import { arredondar, formatBRL, formatMeses, formatPct } from "./format";

/*
  As frases do cartão-resposta: a primeira coisa que a pessoa lê no plano.

  É "textos do plano" como textos.ts — números chegam prontos do motor, aqui só
  viram palavra. Uma resposta só: o objetivo em palavras, quanto por mês (e que
  % do que sobra é isso), por quanto tempo, e o que fica livre.

  Sem jargão na superfície: nada de aporte, excedente, degrau, cascata.
  Puro: sem React, sem I/O; `hoje` entra por parâmetro.
*/

/** A dívida pelo nome curto, com artigo — "o cartão", "a dívida". */
export const NOME_CURTO_DIVIDA: Record<TipoDivida, string> = {
  rotativo: "o cartão",
  cheque_especial: "o cheque especial",
  emprestimo: "o empréstimo",
  financiamento: "o financiamento",
  outra: "a dívida",
};

/** Como o ritmo aparece sozinho, com maiúscula — "Leve", "Equilibrado". */
export const NOME_RITMO: Record<Ritmo, string> = {
  leve: "Leve",
  equilibrado: "Equilibrado",
  acelerado: "Acelerado",
};

/** O tempo do cartão-resposta — o "por quanto tempo". */
export type TempoResposta =
  | {
      tipo: "prazo";
      meses: number;
      /** "dezembro de 2026" */
      mes: string;
      /** o que a tela escreve: "por 3 meses · até dezembro de 2026" */
      texto: string;
      /** pro leitor de tela: "Até o cartão zerar: 3 meses, até dezembro de 2026" */
      rotuloSr: string;
    }
  | {
      tipo: "sem-prazo";
      /** "Não zera nesse ritmo" / "Não fecha nesse ritmo" (text-warn) */
      texto: string;
      /** a frase do que acontece e do que fazer */
      frase: string;
      rotuloSr: string;
      /** quando nenhum ritmo resolve: o link que abre os detalhes na seção de dívidas */
      verDetalhes?: { rotulo: string; secao: "dividas" };
    }
  | {
      tipo: "ano";
      /** o que junta em 12 meses */
      valor: number;
      /** "em 1 ano, R$ 10.080 guardados" */
      texto: string;
      rotuloSr: string;
    }
  | {
      tipo: "parado";
      /** "Parado" */
      texto: string;
      /** "Guardando 0%, o plano não anda. Escolha um ritmo pra voltar a andar." */
      frase: string;
      rotuloSr: string;
    };

/** Um segmento do controle de ritmo. */
export interface SegmentoRitmo {
  ritmo: Ritmo;
  /** "Leve" */
  nome: string;
  /** a % do que sobra nesse ritmo, já com o piso */
  pct: number;
  /** o valor por mês nesse ritmo */
  valor: number;
  /** pro aria-describedby: "R$ 840 por mês; o cartão zera em 3 meses" */
  descricaoSr: string;
}

/** O valor que o passo de agora quer alcançar: "Meta: R$ 40.000", "Total: R$ 3.000". */
export interface AlvoResposta {
  /** "Meta", "Total", "Reserva", "Fôlego" */
  rotulo: string;
  valor: number;
  /** "faltam R$ 5.400" — só quando parte já está guardada */
  detalhe?: string;
  /** pro leitor de tela: "Meta: R$ 40.000" */
  rotuloSr: string;
}

export interface RespostaPlano {
  modo: "plano";
  /** "Seu plano · setembro de 2026" */
  eyebrow: string;
  /** o h1: "Quitar o cartão", "Juntar pra Viagem" */
  objetivo: string;
  /** o valor total a alcançar; ausente quando não há um (guardar sem meta) */
  alvo?: AlvoResposta;
  /** quanto separar por mês, em reais inteiros */
  valorMes: number;
  /** a % do que sobra */
  pct: number;
  /** "70% do que sobra" */
  pctTexto: string;
  tempo: TempoResposta;
  /** quantos meses o rendimento dos potes adianta a meta; ausente quando não adianta */
  rendimentoAdianta?: number;
  /** o que o Guardar deixa livre, em reais inteiros (fecha a soma com `valorMes`); menos de R$ 1 conta como 0 */
  livre: number;
  /** "Os outros R$ 360 são seus, sem culpa." — já descontados TODOS os potes; "Tudo o que sobra vai pros seus potes…" quando nada fica fora */
  fecho: string;
  /** pra onde vai o "Guardar" este mês, curto: "cartão", "fôlego, reserva e metas" */
  esteMes: string;
  /** o botão "Usar o Acelerado", quando outro ritmo tira a dívida do "sem prazo" */
  acaoSugerida?: { ritmo: Ritmo; rotulo: string };
  /** o ritmo marcado no controle; null quando a pessoa escolheu a % à mão */
  ritmoMarcado: Ritmo | null;
  segmentos: SegmentoRitmo[];
  /** a linha embaixo do controle: personalizado ou piso que mordeu; ausente quando não há o que dizer */
  linhaRitmo?: string;
  /** o aria-live da troca: "Equilibrado: separe R$ 840 por mês, 70% do que sobra. O cartão zera em 3 meses." */
  anuncio: string;
}

export interface RespostaCorte {
  modo: "corte";
  /** "Plano de corte · setembro de 2026" */
  eyebrow: string;
  /** "Fazer a conta fechar" */
  objetivo: string;
  /** quanto cortar por mês */
  valorMes: number;
  /** "pra cortar nos custos fixos" */
  linhaValor: string;
  /** o déficit de hoje (0 quando a renda empata com as contas) */
  falta: number;
  /** "Hoje falta R$ 50 por mês" / "Hoje a renda empata com as contas" */
  linhaFalta: string;
  /** "Cortando R$ 230, a conta fecha e sobram R$ 180 (10% da renda) pra começar o plano." */
  frase: string;
  /** "Por onde começar" + as 2 primeiras sugestões; as outras ficam nos detalhes */
  porOndeComecar: { titulo: string; sugestoes: string[] };
  /** "Quando sobrar dinheiro, é aqui que você divide o que sobra." */
  semDivisor: string;
}

export type Resposta = RespostaPlano | RespostaCorte;

export interface OpcoesResposta {
  /** ausente = a meta do perfil do plano */
  meta?: Meta;
  /** a projeção da meta que o resto da tela usa (com os potes); ausente = projetada só com o plano */
  projecaoMeta?: ProjecaoMeta | null;
  /** `simularRitmos(perfil)` — os três ritmos, sem a escolha manual */
  simulacoes: SimulacaoRitmo[];
  /** os potes, pra projetar a meta de cada ritmo com os mesmos potes (sem o "Guardar") */
  grupos?: Grupo[];
  hoje: Date;
}

/** "o cartão" → "O cartão" */
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "o cartão" → "cartão" */
const semArtigo = (s: string) => s.replace(/^(o|a|os|as) /, "");

/** A dívida (ou o grupo delas) como sujeito da frase, com o verbo concordando. */
function sujeitoDividas(lista: DividaAvaliada[], plural: string) {
  const uma = lista.length === 1;
  return {
    sujeito: uma ? NOME_CURTO_DIVIDA[lista[0].tipo] : plural,
    verbo: (singular: string, pluralVerbo: string) => (uma ? singular : pluralVerbo),
  };
}

function objetivoDoPlano(plano: Plano, meta: Meta | undefined): string {
  switch (plano.degrau) {
    case 0:
      return "Montar seu fôlego";
    case 1: {
      const caras = plano.dividas.caras;
      return caras.length === 1 ? `Quitar ${NOME_CURTO_DIVIDA[caras[0].tipo]}` : "Quitar as dívidas caras";
    }
    case 2:
      return "Completar sua reserva";
    case 3: {
      const medias = plano.dividas.medias;
      return medias.length === 1 ? `Antecipar ${NOME_CURTO_DIVIDA[medias[0].tipo]}` : "Antecipar as dívidas";
    }
    case 4:
      return meta ? `Juntar pra ${rotuloMeta(meta)}` : "Guardar pro que você quiser";
  }
}

/**
 * O valor que o passo de agora quer alcançar. É o "até onde" do cartão: sem
 * ele a pessoa lê "R$ 420 por 6 anos" e não sabe pra juntar quanto.
 */
function alvoDoPlano(plano: Plano, meta: Meta | undefined): AlvoResposta | undefined {
  const com = (rotulo: string, valor: number, falta?: number): AlvoResposta | undefined => {
    if (!(valor > 0)) return undefined;
    const detalhe = falta !== undefined && falta > 0 && falta < valor ? `faltam ${formatBRL(falta)}` : undefined;
    return {
      rotulo,
      valor,
      ...(detalhe ? { detalhe } : {}),
      rotuloSr: `${rotulo}: ${formatBRL(valor)}${detalhe ? `, ${detalhe}` : ""}`,
    };
  };
  switch (plano.degrau) {
    case 0:
      return com("Fôlego", plano.folego.alvo, plano.folego.falta);
    case 1:
      return com("Total", plano.dividas.totalCaras);
    case 2:
      return com("Reserva", plano.reserva.alvo, plano.reserva.falta);
    case 3:
      return com("Total", plano.dividas.totalMedias);
    case 4:
      return meta ? com("Meta", meta.valorAlvo) : undefined;
  }
}

/** Guardar ou separar: o dinheiro que paga dívida não é "guardado". */
const verboDoMes = (plano: Plano) => (plano.degrau === 1 || plano.degrau === 3 ? "separe" : "guarde");

/** "Até o cartão zerar" — o rótulo do prazo, pro leitor de tela. */
function rotuloAte(plano: Plano, meta: Meta | undefined): string {
  const { caras, medias } = plano.dividas;
  switch (plano.degrau) {
    case 0:
      return !plano.reserva.ok && plano.reserva.mesesParaCompletar !== null &&
        plano.reserva.mesesParaCompletar === mesesDoFolego(plano)
        ? "Até o fôlego e a reserva ficarem prontos"
        : "Até o fôlego ficar pronto";
    case 1:
      return caras.length === 1 ? `Até ${NOME_CURTO_DIVIDA[caras[0].tipo]} zerar` : "Até as dívidas caras zerarem";
    case 2:
      return "Até a reserva completar";
    case 3:
      return medias.length === 1 ? `Até ${NOME_CURTO_DIVIDA[medias[0].tipo]} acabar` : "Até as dívidas acabarem";
    case 4:
      return meta ? `Até a meta ${rotuloMeta(meta)}` : "Em 1 ano";
  }
}

function mesesDoFolego(plano: Plano): number | null {
  if (plano.folego.ok) return 0;
  return plano.aporte > 0 ? Math.ceil(plano.folego.falta / plano.aporte) : null;
}

/** A frase curta do prazo pro aria-live e pros segmentos: "o cartão zera em 3 meses". */
function prazoCurto(plano: Plano, meta: Meta | undefined, tempo: TempoResposta): string {
  if (tempo.tipo === "parado") return "o plano não anda";
  if (tempo.tipo === "ano") return `em 1 ano, ${formatBRL(tempo.valor)} guardados`;
  const { caras, medias } = plano.dividas;
  const prazo = tempo.tipo === "prazo" ? `em ${formatMeses(tempo.meses)}` : null;
  switch (plano.degrau) {
    case 0:
      return prazo ? `o fôlego fica pronto ${prazo}` : "o fôlego não fica pronto nesse ritmo";
    case 1: {
      const { sujeito, verbo } = sujeitoDividas(caras, "as dívidas caras");
      return prazo ? `${sujeito} ${verbo("zera", "zeram")} ${prazo}` : `${sujeito} não ${verbo("zera", "zeram")} nesse ritmo`;
    }
    case 2:
      return prazo ? `a reserva completa ${prazo}` : "a reserva não completa nesse ritmo";
    case 3: {
      const { sujeito, verbo } = sujeitoDividas(medias, "as dívidas");
      return prazo ? `${sujeito} ${verbo("acaba", "acabam")} ${prazo}` : `${sujeito} não ${verbo("acaba", "acabam")} nesse ritmo`;
    }
    case 4:
      return prazo
        ? meta ? `você chega na meta ${rotuloMeta(meta)} ${prazo}` : `você chega lá ${prazo}`
        : "a meta não fecha nesse ritmo";
  }
}

/**
 * A frase das dívidas caras sem prazo é a MESMA de `semPrazoCaras` em
 * textos.ts (via `semPrazoCarasDoPlano`), pra nunca contradizer os próximos
 * passos. Aqui só se decide a ação: o botão do ritmo que resolve, ou — quando
 * nenhum resolve — o link pros detalhes de renegociação.
 */
function semPrazoDasCaras(plano: Plano): { frase: string; acao?: { ritmo: Ritmo; rotulo: string }; nenhum: boolean } {
  const frase = semPrazoCarasDoPlano(plano);
  const d = plano.diagnosticoCaras;
  if (d?.ritmoQueResolve && d.mesesNoRitmoQueResolve !== null) {
    const ritmo = d.ritmoQueResolve;
    return { frase, acao: { ritmo, rotulo: `Usar o ${NOME_RITMO[ritmo]}` }, nenhum: false };
  }
  return { frase, nenhum: true };
}

/**
 * Ainda existe uma "fatia maior" pra dar à meta? Não com o Guardar em 100% do
 * que sobra, nem — no degrau 4 — com tudo o que sobra já indo pra meta (o
 * Guardar e os potes marcados). Aí a única saída honesta é rever o valor dela.
 */
export function cabeMaisNaMeta(plano: Plano, aporteMensalDaMeta: number): boolean {
  if (plano.livre < LIVRE_MINIMO) return false;
  return plano.degrau !== 4 || plano.resumo.excedente - aporteMensalDaMeta >= LIVRE_MINIMO;
}

function tempoDoPlano(
  plano: Plano,
  meta: Meta | undefined,
  projecaoMeta: ProjecaoMeta | null | undefined,
  hoje: Date,
): { tempo: TempoResposta; acao?: { ritmo: Ritmo; rotulo: string } } {
  const ate = rotuloAte(plano, meta);
  // no degrau 4 os potes marcados levam à meta mesmo com o Guardar em 0%:
  // "Parado" só quando nada contribui
  const potesLevamAMeta = plano.degrau === 4 && meta !== undefined && (projecaoMeta?.aporteMensal ?? 0) > 0;

  if (plano.aporte <= 0 && !potesLevamAMeta) {
    return {
      tempo: {
        tipo: "parado",
        texto: "Parado",
        frase: "Guardando 0%, o plano não anda. Escolha um ritmo pra voltar a andar.",
        rotuloSr: `${ate}: parado, guardando 0%`,
      },
    };
  }

  if (plano.degrau === 4 && !meta) {
    const valor = plano.aporte * 12;
    return {
      tempo: {
        tipo: "ano",
        valor,
        texto: `em 1 ano, ${formatBRL(valor)} guardados`,
        rotuloSr: `Em 1 ano: ${formatBRL(valor)} guardados pro que você quiser`,
      },
    };
  }

  let meses: number | null;
  switch (plano.degrau) {
    case 0:
      meses = mesesDoFolego(plano);
      break;
    case 1:
      meses = plano.dividas.mesesParaQuitarCaras;
      break;
    case 2:
      meses = plano.reserva.mesesParaCompletar;
      break;
    case 3:
      meses = plano.dividas.mesesParaQuitarMedias;
      break;
    case 4:
      meses = projecaoMeta !== undefined && projecaoMeta !== null ? projecaoMeta.meses : meta ? projetarMeta(meta, [], plano.aporte, hoje).meses : null;
      break;
  }

  const mes = meses === null ? null : mesEstimado(hoje, meses);
  if (meses !== null && mes !== null) {
    return {
      tempo: {
        tipo: "prazo",
        meses,
        mes,
        texto: `por ${formatMeses(meses)} · até ${mes}`,
        rotuloSr: `${ate}: ${formatMeses(meses)}, até ${mes}`,
      },
    };
  }

  if (plano.degrau === 1) {
    const { frase, acao, nenhum } = semPrazoDasCaras(plano);
    return {
      tempo: {
        tipo: "sem-prazo",
        texto: "Não zera nesse ritmo",
        frase,
        rotuloSr: `${ate}: não zera nesse ritmo`,
        ...(nenhum ? { verDetalhes: { rotulo: "Ver como nos detalhes", secao: "dividas" as const } } : {}),
      },
      ...(acao ? { acao } : {}),
    };
  }

  if (plano.degrau === 4 && meta) {
    const porMes = projecaoMeta?.aporteMensal ?? plano.aporte;
    return {
      tempo: {
        tipo: "sem-prazo",
        texto: "Não fecha nesse ritmo",
        frase: textos.metaNaoFecha(porMes, rotuloMeta(meta), cabeMaisNaMeta(plano, porMes)),
        rotuloSr: `${ate}: não fecha nesse ritmo`,
      },
    };
  }

  const texto = plano.degrau === 3 ? "Não acaba nesse ritmo" : "Não completa nesse ritmo";
  // com o Guardar em 100% não existe "fatia maior": a saída é mexer na conta
  const frase =
    plano.livre >= LIVRE_MINIMO
      ? "Nesse ritmo, esse passo não fecha. Guarde uma fatia maior do que sobra pra ele andar."
      : plano.degrau === 3
        ? "Mesmo com tudo o que sobra, esse passo não fecha. Renegociar a taxa da dívida é o que muda a conta."
        : "Mesmo com tudo o que sobra, esse passo não fecha. Abrir espaço nos custos fixos é o que muda a conta.";
  return {
    tempo: {
      tipo: "sem-prazo",
      texto,
      frase,
      rotuloSr: `${ate}: ${texto.toLowerCase()}`,
    },
  };
}

/** Pra onde vai o "Guardar" este mês, em poucas palavras: "cartão", "fôlego, reserva e metas". */
function esteMesDoPlano(plano: Plano, meta: Meta | undefined): string {
  const partes = plano.alocacoes.map((a) => {
    switch (a.destino) {
      case "folego":
        return "fôlego";
      case "divida_cara":
        return plano.dividas.caras.length === 1 ? semArtigo(NOME_CURTO_DIVIDA[plano.dividas.caras[0].tipo]) : "dívidas caras";
      case "reserva":
        return "reserva";
      case "divida_media":
        return plano.dividas.medias.length === 1
          ? semArtigo(NOME_CURTO_DIVIDA[plano.dividas.medias[0].tipo])
          : "dívidas";
      case "metas":
        return meta ? rotuloMeta(meta) : "metas";
    }
  });
  if (partes.length === 0) return "nada ainda";
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
}

function respostaDeCorte(plano: Plano, eyebrowMes: string): RespostaCorte {
  const corte = plano.corte;
  const deficit = Math.max(0, corte?.deficit ?? 0);
  const metaCorte = corte?.metaCorte ?? 0;
  const margem = plano.resumo.renda * MARGEM_MINIMA_CORTE;
  const pctMargem = Math.round(MARGEM_MINIMA_CORTE * 100);
  return {
    modo: "corte",
    eyebrow: `Plano de corte · ${eyebrowMes}`,
    objetivo: "Fazer a conta fechar",
    valorMes: metaCorte,
    linhaValor: deficit > 0 ? "pra cortar nos custos fixos" : "pra abrir nos custos fixos",
    falta: deficit,
    linhaFalta: deficit > 0 ? `Hoje falta ${formatBRL(deficit)} por mês` : "Hoje a renda empata com as contas",
    frase:
      deficit > 0
        ? `Cortando ${formatBRL(metaCorte)}, a conta fecha e sobram ${formatBRL(margem)} (${pctMargem}% da renda) pra começar o plano.`
        : `Abrindo ${formatBRL(metaCorte)} nos custos, sobram ${formatBRL(margem)} (${pctMargem}% da renda) pra começar o plano.`,
    porOndeComecar: { titulo: "Por onde começar", sugestoes: (corte?.sugestoes ?? []).slice(0, 2) },
    semDivisor: "Quando sobrar dinheiro, é aqui que você divide o que sobra.",
  };
}

/**
 * A resposta do plano em palavras: o que o cartão do topo da tela mostra.
 *
 * `simulacoes` vem de `simularRitmos(perfil)`: é de lá que saem as % do
 * controle de ritmo (sempre sem a escolha manual). `projecaoMeta` é a mesma
 * projeção que o resto da tela usa, pra o prazo da meta não divergir.
 */
export function respostaDoPlano(plano: Plano, opcoes: OpcoesResposta): Resposta {
  const { simulacoes, hoje } = opcoes;
  const meta = opcoes.meta ?? plano.perfil.meta;
  const eyebrowMes = mesEstimado(hoje, 0) ?? "";

  if (plano.modoCorte) return respostaDeCorte(plano, eyebrowMes);

  const excedente = plano.resumo.excedente;
  /*
    Menos de R$ 1 livre é resíduo de centavos (sobra 1.000,55 com o Guardar em
    1.000 inteiros), não dinheiro: vale zero no livre e na %, senão o cartão
    diria "100%" e "os outros R$ 1 são seus" ao mesmo tempo.
  */
  const semLivre = plano.livre < LIVRE_MINIMO;
  const [valorMesInteiro, livreInteiro] = repartirEmReaisInteiros([plano.aporte, plano.livre], excedente);
  const valorMes = semLivre ? Math.round(plano.aporte) : valorMesInteiro;
  const livre = semLivre ? 0 : livreInteiro;
  // a mesma % que o divisor mostra na linha do Guardar (resíduo de centavos conta como 100%)
  const pct = pctDoGuardar(plano.aporte, excedente);
  const { tempo, acao } = tempoDoPlano(plano, meta, opcoes.projecaoMeta, hoje);
  const personalizado = plano.perfil.aporteEscolhido !== undefined;

  const grupos = opcoes.grupos ?? [];
  const potesSemGuardar = grupos.filter((g) => !g.doSistema);
  const sistema = grupos.find((g) => g.doSistema);
  const segmentos: SegmentoRitmo[] = simulacoes.map((s) => {
    // os outros potes de cada ritmo são os que a troca de ritmo gravaria: encolhidos quando não cabem
    const potes = outrosPotesQueCabem(s.plano, grupos) ?? potesSemGuardar;
    // o "Guardar" de cada ritmo rende a mesma taxa do de hoje: a taxa é do pote, não do valor
    const projecao =
      s.plano.degrau === 4 && meta
        ? sistema?.contaParaMeta
          ? projetarMeta(meta, [...potes, { ...sistema, valor: s.plano.aporte }], 0, hoje)
          : projetarMeta(meta, potes, s.plano.aporte, hoje)
        : undefined;
    const t = tempoDoPlano(s.plano, meta, projecao, hoje).tempo;
    return {
      ritmo: s.ritmo,
      nome: NOME_RITMO[s.ritmo],
      pct: s.pct,
      valor: s.plano.aporte,
      descricaoSr: `${formatBRL(s.plano.aporte)} por mês; ${prazoCurto(s.plano, meta, t)}`,
    };
  });

  let linhaRitmo: string | undefined;
  if (personalizado) {
    linhaRitmo = `Você escolheu ${pct}% à mão. Toque num ritmo pra voltar ao sugerido.`;
  } else if (plano.piso.mordeu) {
    // o piso é da SUGESTÃO: à mão a pessoa pode ir até 100%, e a frase diz como
    const pctTeto = pctDe(plano.piso.teto, excedente);
    const piso = Math.max(0, excedente - plano.piso.teto);
    linhaRitmo = `O ${NOME_RITMO[plano.ritmo]} sugere até ${pctTeto}% pra deixar ${formatBRL(piso)} livres. Quer guardar mais? Suba a % do Guardar.`;
  }

  // o que os juros dos potes adiantam na meta: a recompensa visível de preencher o rendimento
  const adianta =
    plano.degrau === 4 && tempo.tipo === "prazo" && opcoes.projecaoMeta?.semRendimento != null
      ? opcoes.projecaoMeta.semRendimento - tempo.meses
      : 0;
  const alvo = alvoDoPlano(plano, meta);

  /*
    O fecho fala do que fica fora de TODOS os potes, não só do Guardar: com os
    potes ocupando o resto, "os outros R$ 360 são seus" contradizia o divisor
    ("Pra você 0%"). Sem potes (ou todos em zero), é o livre de sempre.
  */
  const somaOutros = potesSemGuardar.reduce(
    (acc, g) => acc + (Number.isFinite(g.valor) ? Math.max(0, g.valor) : 0),
    0,
  );
  const foraDosPotes = somaOutros > 0 ? arredondar(excedente - plano.aporte - somaOutros) : livre;
  const fecho =
    foraDosPotes < LIVRE_MINIMO
      ? "Tudo o que sobra vai pros seus potes este mês."
      : somaOutros > 0
        ? `Os ${formatBRL(foraDosPotes)} que ficam fora dos potes são seus, sem culpa.`
        : `Os outros ${formatBRL(foraDosPotes)} são seus, sem culpa.`;

  const quem = personalizado ? "Do seu jeito" : NOME_RITMO[plano.ritmo];
  const anuncio = `${quem}: ${verboDoMes(plano)} ${formatBRL(valorMes)} por mês, ${pct}% do que sobra. ${maiuscula(prazoCurto(plano, meta, tempo))}.`;

  return {
    modo: "plano",
    eyebrow: `Seu plano · ${eyebrowMes}`,
    objetivo: objetivoDoPlano(plano, meta),
    ...(alvo ? { alvo } : {}),
    valorMes,
    pct,
    pctTexto: `${pct}% do que sobra`,
    tempo,
    ...(adianta > 0 ? { rendimentoAdianta: adianta } : {}),
    livre,
    fecho,
    esteMes: esteMesDoPlano(plano, meta),
    ...(acao ? { acaoSugerida: acao } : {}),
    ritmoMarcado: personalizado ? null : plano.ritmo,
    segmentos,
    ...(linhaRitmo ? { linhaRitmo } : {}),
    anuncio,
  };
}

/*
  As frases do divisor ("Divida o que sobra"). Moram aqui junto com as do
  cartão pra tela não inventar texto: números entram, frase sai.
*/
export const textosDivisor = {
  titulo: "Divida o que sobra",
  /** "R$ 2.800 − R$ 1.600 de contas = R$ 1.200 pra dividir" */
  equacao: (renda: number, contas: number, base: number) =>
    `${formatBRL(renda)} − ${formatBRL(contas)} de contas = ${formatBRL(base)} pra dividir`,
  ajuda: "Tudo em porcentagem: se o salário mudar, a divisão acompanha.",
  /** subtítulo do Guardar: "este mês: cartão" */
  guardarEsteMes: (esteMes: string) => `este mês: ${esteMes}`,
  /** subtítulo do Pra você: sem mínimo, só diz o que é */
  praVoce: (reais: number) => (reais > 0 ? "livre pro dia a dia" : "tudo foi pros potes"),
  /** aria-live quando os potes ocupam tudo */
  anuncioTudoDividido: "Tudo o que sobra está nos potes. Pra dar mais a um, tire de outro.",
  /** digitou acima do que cabe no pote */
  maximoAgora: (pctMax: number) =>
    pctMax >= 100 ? "O máximo é 100%: é tudo o que sobra." : `O máximo agora é ${pctMax}%: o resto já está nos outros potes.`,
  /** dado antigo que passa da sobra (a sobra diminuiu) */
  passouDaSobra: (excesso: number) => `Seus potes passam do que sobra em ${formatBRL(excesso)}.`,
  ajustar: "Ajustar proporcionalmente",
  potesDiminuiram: (ritmo: Ritmo) => `Os outros potes diminuíram pra caber o ${NOME_RITMO[ritmo]}.`,
  poteRemovido: (nome: string) => `Pote ${nome} removido.`,
  semEspaco: "Todo o % livre já está dividido. O pote novo começa em 0%: tire um pouco de outro pra ele.",
  limitePotes: "Chegou no limite de 6 potes. Junte os menores num só.",
  voltarProRitmo: (ritmo: Ritmo, pct: number) => `Voltar pro ${NOME_RITMO[ritmo]} (${pct}%)`,
} as const;

/*
  As frases das linhas de pote e das gavetas do divisor (rendimento, "Entra na
  meta", pote novo). A tela só escolhe qual (recadoDoRendimento, em
  components/resultado/pote-comum.ts); o texto mora aqui.
*/
export const textosPote = {
  /** o campo de rendimento travou no teto (digitou 7, ficou 5) */
  maxRendimento: `O máximo aqui é ${formatPct(MAX_RENDIMENTO_MENSAL)} ao mês.`,
  /** o pote rende, mas a pessoa ainda não escolheu meta */
  rendimentoSemMeta: "Esse rendimento entra na conta quando você escolher uma meta: é no prazo dela que ele aparece.",
  /** o pote rende, mas não entra na meta */
  ligarEntraNaMeta: (nomeMeta: string) =>
    `Pra esse rendimento encurtar o prazo, ligue “Entra na meta ${nomeMeta}” nas opções do pote (⋯).`,
  /** o rendimento do "Guardar" antes do degrau de metas */
  guardarAntesDaMeta: (nomeMeta: string) =>
    `Por enquanto o Guardar paga o que vem antes da meta (fôlego, dívidas, reserva). Esse rendimento entra no prazo da meta ${nomeMeta} quando o plano chegar nela.`,
  /** a ajuda do "Entra na meta" do "Guardar" antes do degrau de metas */
  guardarAindaNaoEntra: (nomeMeta: string) =>
    `Por enquanto o Guardar paga o que vem antes da meta. Ele passa a somar no tempo até a ${nomeMeta} quando o plano chegar nela.`,
  /** a descrição da gaveta "Novo pote" */
  poteNovoComeca: (pct: number, valor: number) =>
    pct > 0
      ? `Escolha um nome. Ele começa com ${pct}% e você ajusta depois.`
      : `Escolha um nome. Ele começa com ${formatBRL(valor)} e você ajusta depois.`,
} as const;
