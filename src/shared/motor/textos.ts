/*
  GERADO a partir de dindinFrontend/src/domain/textos.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { formatBRL, formatMeses, formatPct } from "./format";
import { MARGEM_MINIMA_CORTE, MESES_SIMULACAO_MAX } from "./config";
import type {
  Degrau,
  DiagnosticoDividaCara,
  DividaAvaliada,
  Folego,
  GastoFixoDetalhado,
  Perfil,
  PlanoDeCorte,
  QuadroDividas,
  Reserva,
  Resumo,
  Ritmo,
  TipoDivida,
} from "./types";

/*
  Tudo que o plano diz em palavras vive aqui. Números já chegam calculados;
  este arquivo só transforma em frase. Tom: direto, sem julgamento, sem jargão.
  Nunca cita produto, banco ou emissor — é o limite regulatório do produto.
*/

export const NOME_DIVIDA: Record<TipoDivida, string> = {
  rotativo: "o rotativo do cartão",
  cheque_especial: "o cheque especial",
  emprestimo: "o empréstimo",
  financiamento: "o financiamento",
  outra: "essa dívida",
};

export const ROTULO_DIVIDA: Record<TipoDivida, string> = {
  rotativo: "Rotativo do cartão",
  cheque_especial: "Cheque especial",
  emprestimo: "Empréstimo pessoal",
  financiamento: "Financiamento",
  outra: "Outra dívida",
};

export const ROTULO_DEGRAU: Record<Degrau, string> = {
  0: "Fôlego mínimo",
  1: "Dívida cara",
  2: "Reserva de emergência",
  3: "Dívida média",
  4: "Metas",
};

/** Como o ritmo é chamado no meio de uma frase ("no ritmo equilibrado"). */
export const ROTULO_RITMO: Record<Ritmo, string> = {
  leve: "leve",
  equilibrado: "equilibrado",
  acelerado: "acelerado",
};

interface Contexto {
  perfil: Perfil;
  resumo: Resumo;
  degrau: Degrau;
  ritmo: Ritmo;
  folego: Folego;
  reserva: Reserva;
  dividas: QuadroDividas;
  diagnosticoCaras: DiagnosticoDividaCara | null;
  corte: PlanoDeCorte | null;
  aporte: number;
  livre: number;
}

const rendaEhFixa = (p: Perfil) => p.tipoRenda === "clt";

function decisao(c: Contexto): { titulo: string; texto: string } {
  if (c.corte) {
    if (c.corte.deficit <= 0) {
      return {
        titulo: "Antes de qualquer plano, precisa sobrar alguma coisa.",
        texto: "Hoje sua renda fecha exatamente com os custos fixos: não sobra nada pra guardar. Então o plano deste mês é abrir espaço, não fazer aporte.",
      };
    }
    return {
      titulo: "Antes de qualquer plano, seus custos precisam caber na sua renda.",
      texto: `Hoje seus custos fixos passam da renda em ${formatBRL(c.corte.deficit)} por mês. Nenhum plano de guardar funciona antes disso fechar — então o plano deste mês é de corte, não de aporte.`,
    };
  }

  switch (c.degrau) {
    case 0:
      return {
        titulo: `Seu próximo passo é montar um fôlego de ${formatBRL(c.folego.alvo)}.`,
        texto: `É um colchão pequeno, em conta com liquidez diária, pra um imprevisto não te empurrar pro cartão. Faltam ${formatBRL(c.folego.falta)} — e ele vem antes até das dívidas, porque sem ele qualquer surpresa desfaz o resto.`,
      };
    case 1: {
      const d = c.dividas.caras[0];
      return {
        titulo: `Seu próximo passo é quitar ${NOME_DIVIDA[d.tipo]}.`,
        texto: `Só de juros, ${NOME_DIVIDA[d.tipo]} custa ${formatBRL(d.jurosMensais)} por mês (${formatPct(d.taxaAnual)} ao ano). Nenhuma aplicação rende isso — quitar é o melhor retorno que existe hoje pro seu dinheiro.`,
      };
    }
    case 2:
      return {
        titulo: "Seu próximo passo é completar sua reserva de emergência.",
        texto: `Como sua renda é ${rendaEhFixa(c.perfil) ? "fixa" : "variável"}, a reserva ideal é ${c.reserva.multiplicador} meses dos seus custos: ${formatBRL(c.reserva.alvo)}. Faltam ${formatBRL(c.reserva.falta)}. É o que separa um imprevisto de uma dívida.`,
      };
    case 3: {
      const d = c.dividas.medias[0];
      return {
        titulo: `Seu próximo passo é antecipar ${NOME_DIVIDA[d.tipo]}.`,
        texto: `A taxa dele (${formatPct(d.taxaAnual)} ao ano) é maior do que o dinheiro rende parado. Com a reserva completa, cada parcela antecipada é ganho garantido.`,
      };
    }
    case 4:
      return {
        titulo: "Você já pode definir uma meta.",
        texto: "Sem dívida cara e com reserva completa, todo real que sobra pode trabalhar pra algo seu. Escolha um objetivo e guarde esse valor separado pra ele.",
      };
  }
}

/**
 * O aviso de dívida cara sem prazo.
 *
 * "É o único caminho" só pode sair quando NENHUM dos três ritmos zera a dívida.
 * Medido em milhares de perfis: no leve uma parte deles nunca zera e no
 * equilibrado zera em três anos — afirmar que só a renegociação resolve, ao
 * lado de um cartão que oferece o outro caminho, é mentira.
 *
 * A causa também muda a frase: "os juros crescem mais rápido do que você paga"
 * é falso quando a dívida cai, só que devagar demais pro horizonte da conta.
 */
function semPrazoCaras(c: Contexto): string {
  const d = c.diagnosticoCaras;
  const horizonte = d?.motivo === "horizonte";
  const uma = c.dividas.caras.length === 1;
  const sujeito = uma ? NOME_DIVIDA[c.dividas.caras[0].tipo] : "as dívidas caras";
  const prazoMaximo = formatMeses(MESES_SIMULACAO_MAX);

  if (d?.ritmoQueResolve && d.mesesNoRitmoQueResolve !== null) {
    const causa = horizonte
      ? `${sujeito} ${uma ? "levaria" : "levariam"} mais de ${prazoMaximo} pra zerar`
      : "os juros crescem mais rápido do que você paga";
    return `Neste ritmo, ${causa}. No ritmo ${ROTULO_RITMO[d.ritmoQueResolve]} — que guarda uma fatia maior do que sobra — ${sujeito} ${uma ? "zera" : "zeram"} em ${formatMeses(d.mesesNoRitmoQueResolve)}.`;
  }

  const causa = horizonte
    ? `as dívidas caras levariam mais de ${prazoMaximo} pra zerar`
    : "os juros das dívidas caras crescem mais rápido do que você paga";
  return `Atenção: com o aporte de hoje, ${causa}. Renegociar ou trocar por uma linha mais barata não é opcional — é o único caminho.`;
}

function proximosPassos(c: Contexto): string[] {
  const passos: string[] = [];

  if (c.corte) {
    // as sugestões já aparecem na seção de corte; aqui é só o que fazer com elas
    passos.push("Escolha um item da lista de corte e ataque só ele este mês. Um já muda a conta.");
    passos.push("Quando fechar no azul, refaça o plano: a cascata começa a funcionar no primeiro mês que sobrar dinheiro.");
    return passos;
  }

  passos.push(
    `Separe ${formatBRL(c.aporte)} no dia que a renda cair, antes de gastar. O que fica — ${formatBRL(c.livre)} — é seu pra usar sem culpa.`,
  );

  if (!c.folego.ok) {
    passos.push(`Deixe o fôlego numa conta separada, com liquidez diária. Não é investimento: é pra não precisar do cartão.`);
  }

  if (c.dividas.caras.length > 0) {
    const m = c.dividas.mesesParaQuitarCaras;
    if (m === null) {
      passos.push(semPrazoCaras(c));
    } else {
      passos.push(`Mantendo esse ritmo, as dívidas caras zeram em ${formatMeses(m)}. Cada mês a menos economiza ${formatBRL(c.dividas.jurosMensaisCaras)} de juros.`);
    }
    if (c.dividas.caras.length > 1) {
      passos.push("Pague a de maior taxa primeiro e só o mínimo nas outras. Quando ela zerar, a parcela dela reforça a próxima.");
    }
  }

  if (c.folego.ok && c.dividas.caras.length === 0 && !c.reserva.ok) {
    const m = c.reserva.mesesParaCompletar;
    passos.push(
      m === null
        ? `A reserva de ${formatBRL(c.reserva.alvo)} entra assim que as prioridades de cima estiverem resolvidas.`
        : `Nesse ritmo, a reserva de ${formatBRL(c.reserva.alvo)} fica completa em ${formatMeses(m)}.`,
    );
  }

  if (c.degrau === 3 && c.dividas.mesesParaQuitarMedias !== null) {
    passos.push(`Antecipando ${formatBRL(c.aporte)} por mês, ${NOME_DIVIDA[c.dividas.medias[0].tipo]} termina em ${formatMeses(c.dividas.mesesParaQuitarMedias)}.`);
  }

  if (c.degrau === 4) {
    passos.push(
      `Guarde os ${formatBRL(c.aporte)} num lugar só pra um objetivo seu e dê um nome pra ele. Em breve o dindin calcula quanto por mês e a data de chegada.`,
    );
  }

  passos.push("Volte no mês que vem e refaça as respostas com o que mudou: o plano se recalcula na hora.");
  return passos;
}

const alocacao = {
  folego: (f: Folego) => ({
    titulo: "Fôlego mínimo",
    descricao: `Colchão de ${formatBRL(f.alvo)} com liquidez diária. Faltam ${formatBRL(f.falta)}.`,
  }),
  dividaCara: (caras: DividaAvaliada[]) => ({
    titulo: caras.length === 1 ? ROTULO_DIVIDA[caras[0].tipo] : "Dívidas caras",
    descricao:
      caras.length === 1
        ? `Vai inteiro pra ${NOME_DIVIDA[caras[0].tipo]}, que cobra ${formatPct(caras[0].taxaAnual)} ao ano.`
        : `Vai pra ${NOME_DIVIDA[caras[0].tipo]} primeiro — a de maior taxa. As outras recebem só o mínimo até essa zerar.`,
  }),
  reserva: (r: Reserva) => ({
    titulo: "Reserva de emergência",
    descricao: `Meta de ${formatBRL(r.alvo)}, ${r.multiplicador} meses dos seus custos. Faltam ${formatBRL(r.falta)}.`,
  }),
  dividaMedia: (medias: DividaAvaliada[]) => ({
    titulo: medias.length === 1 ? ROTULO_DIVIDA[medias[0].tipo] : "Dívidas médias",
    descricao: `Antecipa ${NOME_DIVIDA[medias[0].tipo]}: a taxa (${formatPct(medias[0].taxaAnual)} ao ano) é maior do que o dinheiro rende guardado.`,
  }),
  metas: () => ({
    titulo: "Metas",
    descricao: "Livre pra um objetivo seu. Em breve: nome, valor e data, com a conta feita pelo dindin.",
  }),
};

const corte = {
  renegociar: (d: DividaAvaliada) =>
    `Renegociar ${NOME_DIVIDA[d.tipo]}: a ${formatPct(d.taxaAnual)} ao ano, ele sozinho custa ${formatBRL(d.jurosMensais)} por mês de juros. Trocar por uma linha mais barata é o corte mais rápido que existe.`,
  moradiaPesada: (custo: number, renda: number) =>
    `Moradia leva ${formatPct(custo / renda)} da sua renda — acima de 30% é o maior peso do orçamento. Vale olhar dividir, negociar ou mudar.`,
  assinaturas: () =>
    "Liste tudo que sai automático (assinaturas, apps, planos) e cancele o que não usou nos últimos 30 dias.",
  maioresGastos: (maiores: GastoFixoDetalhado[]) => {
    const lista = maiores.map((g) => `${g.nomeExibido} (${formatBRL(g.valor)})`);
    const enumerado =
      lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(", ")} e ${lista.at(-1)}`;
    const maior = maiores[0];
    return `Onde o dinheiro está indo: ${enumerado}. Comece pelo maior — tirar um quinto de ${maior.nomeExibido} já libera ${formatBRL(maior.valor * 0.2)} por mês.`;
  },
  rendaExtra: (metaCorte: number) =>
    `Pelo lado da renda: ${formatBRL(metaCorte)} a mais no mês — um freela, uma hora extra, uma venda — já fecha a conta enquanto os cortes não chegam.`,
  meta: (metaCorte: number, renda: number, deficit: number) =>
    deficit <= 0
      ? `Meta do mês: abrir ${formatBRL(metaCorte)} nos custos fixos — ${formatPct(MARGEM_MINIMA_CORTE)} da renda — pra começar o plano.`
      :
    `Meta do mês: reduzir ${formatBRL(metaCorte)} nos custos fixos. Isso zera o vermelho e deixa sobrar ${formatPct(MARGEM_MINIMA_CORTE)} da renda (${formatBRL(renda * MARGEM_MINIMA_CORTE)}) pra começar o plano.`,
};

export const textos = { decisao, proximosPassos, alocacao, corte };
