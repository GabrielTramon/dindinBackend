/*
  GERADO a partir de dindinFrontend/src/domain/textos.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { formatBRL, formatMeses, formatPct } from "./format";
import { LIMIAR_MORADIA_PESADA, MARGEM_MINIMA_CORTE, MESES_SIMULACAO_MAX } from "./config";
import { rotuloMeta } from "./metas-catalogo";
import type {
  Degrau,
  DiagnosticoDividaCara,
  DividaAvaliada,
  Folego,
  GastoFixoDetalhado,
  Meta,
  Perfil,
  Plano,
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

/*
  NOME_DIVIDA já vem com artigo ("o empréstimo", "essa dívida") porque as telas
  usam assim. No meio da frase o artigo contrai com a preposição e o pronome
  concorda com o gênero — "pra o rotativo" e "essa dívida... a taxa dele" eram
  erros de concordância. Estes helpers fazem a contração num lugar só.
*/
const DIVIDA_FEMININA: Record<TipoDivida, boolean> = {
  rotativo: false,
  cheque_especial: false,
  emprestimo: false,
  financiamento: false,
  outra: true,
};

/** "pro empréstimo", "pra essa dívida" */
function praDivida(tipo: TipoDivida): string {
  const nome = NOME_DIVIDA[tipo];
  if (nome.startsWith("o ")) return `pro ${nome.slice(2)}`;
  if (nome.startsWith("a ")) return `pra ${nome.slice(2)}`;
  return `pra ${nome}`;
}

/** "do empréstimo", "dessa dívida" */
function daDivida(tipo: TipoDivida): string {
  const nome = NOME_DIVIDA[tipo];
  if (nome.startsWith("o ")) return `do ${nome.slice(2)}`;
  if (nome.startsWith("a ")) return `da ${nome.slice(2)}`;
  return `d${nome}`;
}

/** "ele"/"ela" conforme a dívida */
const pronome = (tipo: TipoDivida) => (DIVIDA_FEMININA[tipo] ? "ela" : "ele");

/** Uma dívida pelo nome, várias pelo plural genérico — com o verbo concordando. */
function sujeitoDas(lista: DividaAvaliada[], plural: string) {
  const uma = lista.length === 1;
  return {
    uma,
    sujeito: uma ? NOME_DIVIDA[lista[0].tipo] : plural,
    /** conjuga: verbo("zera", "zeram") */
    verbo: (singular: string, pluralVerbo: string) => (uma ? singular : pluralVerbo),
  };
}

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
  /** o aporte é o valor que a pessoa digitou no "Guardar", não o do ritmo */
  aporteEditado?: boolean;
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
        texto: `A taxa d${pronome(d.tipo)} (${formatPct(d.taxaAnual)} ao ano) é maior do que o dinheiro rende parado. Com a reserva completa, cada parcela antecipada é ganho garantido.`,
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
  const caras = c.dividas.caras;
  const { uma, sujeito, verbo } = sujeitoDas(caras, "as dívidas caras");
  const prazoMaximo = formatMeses(MESES_SIMULACAO_MAX);
  const causa = horizonte
    ? `${sujeito} ${verbo("levaria", "levariam")} mais de ${prazoMaximo} pra zerar`
    : "os juros crescem mais rápido do que você paga";
  // com o "Guardar" editado, "neste ritmo" não descreve o que a pessoa faz:
  // o que ela faz é guardar um valor — ou nada
  const hoje = !c.aporteEditado
    ? "Neste ritmo"
    : c.aporte > 0
      ? `Guardando ${formatBRL(c.aporte)} por mês`
      : "Só com as parcelas";

  if (d?.ritmoQueResolve && d.mesesNoRitmoQueResolve !== null) {
    const comparacao = !c.aporteEditado
      ? "que guarda uma fatia maior do que sobra"
      : c.aporte > 0
        ? `que guarda mais do que os ${formatBRL(c.aporte)} de hoje`
        : "que separa uma parte do que sobra";
    return `${hoje}, ${causa}. No ritmo ${ROTULO_RITMO[d.ritmoQueResolve]} — ${comparacao} — ${sujeito} ${verbo("zera", "zeram")} em ${formatMeses(d.mesesNoRitmoQueResolve)}.`;
  }

  // nenhum ritmo resolve, mas o "Guardar" em 100% (à mão) resolve: "único
  // caminho" seria mentira — renegociar ajuda, não é a única saída
  if (d?.guardandoTudo) {
    const { valor, meses } = d.guardandoTudo;
    return `${hoje}, ${causa}. Guardando tudo o que sobra (${formatBRL(valor)}), ${sujeito} ${verbo("zera", "zeram")} em ${formatMeses(meses)}; renegociar ou trocar por uma linha mais barata ainda ajuda a sair antes.`;
  }

  const causaSemSaida = horizonte
    ? causa
    : `os juros ${uma ? daDivida(caras[0].tipo) : "das dívidas caras"} crescem mais rápido do que você paga`;
  return `Atenção: com o que sobra hoje, ${causaSemSaida}. Renegociar ou trocar por uma linha mais barata não é opcional — é o único caminho.`;
}

/**
 * O mesmo aviso de dívida cara sem prazo, a partir de um Plano pronto — é o
 * que o cartão-resposta mostra, então ele e os próximos passos nunca dizem
 * coisas diferentes. "Editado" é o perfil ter um "Guardar" escolhido à mão,
 * a mesma regra que o motor usa quando não recebe opções.
 */
export function semPrazoCarasDoPlano(plano: Plano): string {
  const escolhido = plano.perfil.aporteEscolhido;
  return semPrazoCaras({
    ...plano,
    aporteEditado: escolhido !== undefined && Number.isFinite(escolhido),
  });
}

/**
 * Menos de R$ 1 livre é resíduo de centavos, não dinheiro pra usar: com a
 * sobra em 1.000,55 e o Guardar em 100%, o aporte fica em 1.000 inteiros e
 * sobram 0,55 — que a tela escreveria "R$ 1". O cartão e o divisor tratam igual.
 */
export const LIVRE_MINIMO = 1;

/**
 * O primeiro passo: quanto separar. Não diz QUANTO fica livre — os potes da
 * pessoa mudam esse número e o motor não os conhece (o cartão, que conhece,
 * é quem diz o valor). Com nada livre ("Guardar" em 100%) não diz "R$ 0 é seu".
 */
function primeiroPasso(c: Contexto): string {
  if (c.aporte > 0) {
    return c.livre >= LIVRE_MINIMO
      ? `Separe ${formatBRL(c.aporte)} no dia que a renda cair, antes de gastar. O que fica é seu pra usar sem culpa.`
      : `Separe ${formatBRL(c.aporte)} no dia que a renda cair, antes de gastar: este mês tudo o que sobra vai pro plano.`;
  }
  // "Separe R$ 0" é instrução vazia: com nada guardado, o passo diz isso — e,
  // como no ramo de cima, sem o valor: os potes da pessoa podem levar parte (ou
  // tudo) do que sobra, e "os R$ 1.500 são seus" contradiria o cartão
  return c.livre >= LIVRE_MINIMO
    ? "Este mês o plano não separa nada: o que sobra é seu pra usar sem culpa."
    : "Este mês o plano não separa nada.";
}

function proximosPassos(c: Contexto): string[] {
  const passos: string[] = [];

  if (c.corte) {
    // as sugestões já aparecem na seção de corte; aqui é só o que fazer com elas
    passos.push("Escolha um item da lista de corte e ataque só ele este mês. Um já muda a conta.");
    passos.push("Quando fechar no azul, refaça o plano: a cascata começa a funcionar no primeiro mês que sobrar dinheiro.");
    return passos;
  }

  passos.push(primeiroPasso(c));

  if (!c.folego.ok) {
    passos.push(`Deixe o fôlego numa conta separada, com liquidez diária. Não é investimento: é pra não precisar do cartão.`);
  }

  if (c.dividas.caras.length > 0) {
    const m = c.dividas.mesesParaQuitarCaras;
    if (m === null) {
      passos.push(semPrazoCaras(c));
    } else {
      const { sujeito, verbo } = sujeitoDas(c.dividas.caras, "as dívidas caras");
      const juros = formatBRL(c.dividas.jurosMensaisCaras);
      passos.push(
        c.aporte > 0
          ? `Mantendo esse ritmo, ${sujeito} ${verbo("zera", "zeram")} em ${formatMeses(m)}. Cada mês a menos economiza ${juros} de juros.`
          : // nada guardado: quem quita são só as parcelas, e é isso que o texto diz
            `Só com as parcelas, ${sujeito} ${verbo("zera", "zeram")} em ${formatMeses(m)}. Guardar qualquer valor por mês encurta esse prazo — cada mês a menos economiza ${juros} de juros.`,
      );
    }
    if (c.dividas.caras.length > 1) {
      passos.push("Pague a de maior taxa primeiro e só o mínimo nas outras. Quando ela zerar, a parcela dela reforça a próxima.");
    }
  }

  if (c.folego.ok && c.dividas.caras.length === 0 && !c.reserva.ok) {
    const m = c.reserva.mesesParaCompletar;
    // aqui não há nada acima da reserva (fôlego ok, sem dívida cara): sem
    // prazo, o único motivo é não estar guardando nada
    passos.push(
      m === null
        ? `Com nada sendo guardado por mês, a reserva de ${formatBRL(c.reserva.alvo)} não avança. Qualquer valor já começa a encher.`
        : `Nesse ritmo, a reserva de ${formatBRL(c.reserva.alvo)} fica completa em ${formatMeses(m)}.`,
    );
  }

  if (c.degrau === 3 && c.dividas.mesesParaQuitarMedias !== null) {
    // o prazo é o de TODAS as médias: com mais de uma, o nome da primeira mentiria
    const { sujeito, verbo } = sujeitoDas(c.dividas.medias, "as dívidas médias");
    const prazo = formatMeses(c.dividas.mesesParaQuitarMedias);
    passos.push(
      c.aporte > 0
        ? `Antecipando ${formatBRL(c.aporte)} por mês, ${sujeito} ${verbo("termina", "terminam")} em ${prazo}.`
        : // nada antecipado: quem quita são só as parcelas
          `Só com as parcelas, ${sujeito} ${verbo("termina", "terminam")} em ${prazo}.`,
    );
  }

  // com nada separado não há o que "guardar num lugar separado": o primeiro
  // passo já disse que o plano não separa nada este mês
  if (c.degrau === 4 && c.aporte > 0) {
    const meta = c.perfil.meta;
    passos.push(
      meta
        ? `Guarde os ${formatBRL(c.aporte)} num lugar separado, só pra sua meta: ${rotuloMeta(meta)}. Em "Sua meta" você vê quanto tempo falta pra chegar lá.`
        : `Guarde os ${formatBRL(c.aporte)} num lugar só pra um objetivo seu. Dê um nome e um valor pra ele na pergunta da meta e o dindin mostra quando você chega lá.`,
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
        ? `Vai inteiro ${praDivida(caras[0].tipo)}, que cobra ${formatPct(caras[0].taxaAnual)} ao ano.`
        : `Vai ${praDivida(caras[0].tipo)} primeiro — a de maior taxa. As outras recebem só o mínimo até essa zerar.`,
  }),
  reserva: (r: Reserva) => ({
    titulo: "Reserva de emergência",
    descricao: `Meta de ${formatBRL(r.alvo)}, ${r.multiplicador} meses dos seus custos. Faltam ${formatBRL(r.falta)}.`,
  }),
  dividaMedia: (medias: DividaAvaliada[]) => ({
    titulo: medias.length === 1 ? ROTULO_DIVIDA[medias[0].tipo] : "Dívidas médias",
    descricao: `Antecipa ${NOME_DIVIDA[medias[0].tipo]}: a taxa (${formatPct(medias[0].taxaAnual)} ao ano) é maior do que o dinheiro rende guardado.`,
  }),
  metas: (meta?: Meta) => ({
    titulo: "Metas",
    descricao: meta
      ? `Vai pra sua meta: ${rotuloMeta(meta)}.`
      : "Livre pra um objetivo seu. Com uma meta definida, o dindin mostra quando você chega lá.",
  }),
};

const corte = {
  renegociar: (d: DividaAvaliada) =>
    `Renegociar ${NOME_DIVIDA[d.tipo]}: a ${formatPct(d.taxaAnual)} ao ano, ${pronome(d.tipo)} ${DIVIDA_FEMININA[d.tipo] ? "sozinha" : "sozinho"} custa ${formatBRL(d.jurosMensais)} por mês de juros. Trocar por uma linha mais barata é o corte mais rápido que existe.`,
  /** "o maior peso" só quando é verdade: um gasto fixo pode pesar mais que a moradia */
  moradiaPesada: (custo: number, renda: number, maiorGasto: number) =>
    custo >= maiorGasto
      ? `Moradia leva ${formatPct(custo / renda)} da sua renda: passa dos ${formatPct(LIMIAR_MORADIA_PESADA)} e é o maior peso do orçamento. Vale olhar dividir, negociar ou mudar.`
      : `Moradia leva ${formatPct(custo / renda)} da sua renda: passa dos ${formatPct(LIMIAR_MORADIA_PESADA)}. Vale olhar dividir, negociar ou mudar.`,
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

/** "Investimento, Namoro e Emergência" */
function listar(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}

/**
 * A meta que não fecha em 50 anos — a MESMA frase no cartão e em "Sua meta".
 * "Guarde uma fatia maior" só quando existe fatia maior: com o Guardar em 100%
 * (ou tudo o que sobra já indo pra meta) a única saída honesta é rever o valor.
 */
function metaNaoFecha(porMes: number, nome: string | null, cabeMais: boolean): string {
  const saida = cabeMais ? "Guarde uma fatia maior ou reveja o valor dela." : "Reveja o valor dela.";
  return `Com ${formatBRL(porMes)} por mês, a meta${nome ? ` ${nome}` : ""} não fecha nem em ${formatMeses(MESES_SIMULACAO_MAX)}. ${saida}`;
}

/**
 * A regra de verdade dos ritmos (motor.ts, aportePorDegrau): o piso de 10% da
 * renda só segura o Acelerado, e nunca abaixo do que o Equilibrado guardaria —
 * com sobra pequena, o Acelerado deixa menos de 10% livre. À mão não há piso.
 */
const sobreOsRitmos = `Nenhum ritmo sugere guardar tudo o que sobra. O Acelerado para antes de deixar menos de ${formatPct(MARGEM_MINIMA_CORTE)} da sua renda livre; quando sobra pouco, ele sugere o mesmo que o Equilibrado. No Guardar, à mão, você pode ir até 100%.`;

/** As frases de "Sua meta" nos detalhes, com a projeção do caminho. */
const metaDetalhe = {
  /** o que vem depois de "Chega em 2 anos, por volta de março de 2028" */
  comoChega: (o: { degrauDeMetas: boolean; aporteMensal: number; inicio: number | null; temPotes: boolean }) => {
    if (o.degrauDeMetas) return `, com ${formatBRL(o.aporteMensal)} por mês.`;
    // um passo de antes sem prazo: o plano nunca chega na meta nessa conta
    if (o.inicio === null) {
      return ": só com os potes marcados. O que o plano guarda entra quando as prioridades de cima tiverem prazo.";
    }
    return o.temPotes
      ? ": os potes marcados entram desde já e o plano soma quando as prioridades de cima fecharem."
      : ": o plano começa a juntar pra ela quando as prioridades de cima fecharem.";
  },
  /** "Entra nesta conta: Investimento e o que o plano guarda, quando as prioridades de cima fecharem." */
  entraNaConta: (potes: string[], planoEntra: boolean, planoDepois: boolean) => {
    const partes = [...potes, ...(planoEntra ? ["o que o plano guarda"] : [])];
    return `Entra nesta conta: ${listar(partes)}${planoEntra && planoDepois ? ", quando as prioridades de cima fecharem" : ""}.`;
  },
};

export const textos = { decisao, proximosPassos, alocacao, corte, metaNaoFecha, sobreOsRitmos, metaDetalhe };
