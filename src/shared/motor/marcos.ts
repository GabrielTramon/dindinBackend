/*
  GERADO a partir de dindinFrontend/src/domain/marcos.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { MAX_RENDIMENTO_MENSAL, MESES_SIMULACAO_MAX } from "./config";
import { rotuloMeta } from "./metas-catalogo";
import { gerarPlano } from "./motor";
import { mesEmTexto, type Grupo, type ProjecaoMeta } from "./organizacao";
import type { DividaAvaliada, Meta, Plano, TipoDivida } from "./types";
import { arredondar, formatBRL } from "./format";

/*
  "Seu caminho": os marcos do plano inteiro, com prazo e mês — o "por quanto
  tempo" de tudo, não só do degrau de hoje.

  Os prazos são os ACUMULADOS que o motor já calcula (contam a partir deste mês,
  que é o mês 1). Nada é recalculado aqui por conta própria: o caminho não pode
  prometer um mês que o resto do plano não promete. A única conta nova é a da
  meta ANTES do degrau 4 (`projetarMetaNoCaminho`), que o motor não faz.

  Puro: sem React, sem I/O; `hoje` entra por parâmetro.
*/

export type EstadoMarco = "feito" | "atual" | "depois";

export interface Marco {
  /** estável entre renders: "folego", "caras", "reserva", "medias", "meta"; fundidos viram "folego+reserva" */
  id: string;
  /** "Cartão quitado", "Reserva de R$ 4.800", "Viagem", "Fôlego e reserva prontos" */
  rotulo: string;
  /** prazo acumulado em meses; null = sem prazo nesse ritmo (ou depende de um marco sem prazo) */
  meses: number | null;
  /** o mês curto do marco, "dez 2026"; null quando não há prazo (ou num marco feito) */
  mes: string | null;
  /** o mesmo mês por extenso, "dezembro de 2026" */
  mesExtenso: string | null;
  estado: EstadoMarco;
  /**
   * true só no marco cujo PRÓPRIO prazo é null ("sem prazo nesse ritmo"). Os
   * seguintes dependem dele: têm `meses: null` e `semPrazo: false` ("depois").
   */
  semPrazo: boolean;
}

export interface OpcoesMarcos {
  /** ausente = a meta do perfil do plano */
  meta?: Meta;
  /** a lista inteira de potes, com o "Guardar" junto */
  grupos?: Grupo[];
  hoje: Date;
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * O mês daqui a `n` meses por extenso — "dezembro de 2026". É a MESMA convenção
 * de `projetarMeta` (mesmo helper): o caminho, o cartão-resposta e a meta nunca
 * discordam sobre qual é o mês.
 */
export function mesEstimado(hoje: Date, n: number): string | null {
  return mesEmTexto(hoje, n);
}

/** O mesmo mês em forma curta — "dez 2026" —, pra coluna do caminho. */
export function mesCurto(hoje: Date, n: number): string | null {
  if (!(hoje instanceof Date) || Number.isNaN(hoje.getTime())) return null;
  const total = hoje.getMonth() + n;
  const ano = hoje.getFullYear() + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12;
  return `${MESES_CURTOS[mes]} ${ano}`;
}

/** "Cartão quitado", "Dívida quitada" — o marco de uma dívida só. */
const QUITADO: Record<TipoDivida, string> = {
  rotativo: "Cartão quitado",
  cheque_especial: "Cheque especial quitado",
  emprestimo: "Empréstimo quitado",
  financiamento: "Financiamento quitado",
  outra: "Dívida quitada",
};

function rotuloDividas(lista: DividaAvaliada[], plural: string): string {
  return lista.length === 1 ? QUITADO[lista[0].tipo] : plural;
}

function taxaDoGrupo(rendimentoMensal: number | undefined): number {
  if (rendimentoMensal === undefined || !Number.isFinite(rendimentoMensal)) return 0;
  return Math.min(Math.max(0, rendimentoMensal), MAX_RENDIMENTO_MENSAL);
}

const emCentavosReais = (valor: number): number =>
  Number.isFinite(valor) ? arredondar(Math.max(0, Math.round(arredondar(valor) * 100)) / 100) : 0;

/**
 * Mês a mês, como `projetarMeta`, mas o aporte do plano só entra a partir do
 * mês `inicio + 1` (antes disso ele está pagando dívida ou enchendo a reserva)
 * e rende `taxaPlano` a partir daí. A ordem das contribuições e das somas é a
 * mesma de `projetarMeta`: com `inicio` 0 e taxa 0 o resultado é idêntico, bit
 * a bit.
 */
function mesesAteOAlvo(
  grupos: { valor: number; taxa: number }[],
  doPlano: number,
  inicio: number,
  valorAlvo: number,
  taxaPlano = 0,
): number | null {
  if (valorAlvo <= 0) return 0;
  if (!grupos.some((c) => c.valor > 0) && doPlano <= 0) return null;

  const saldos = grupos.map(() => 0);
  let saldoPlano = 0;
  for (let mes = 1; mes <= MESES_SIMULACAO_MAX; mes++) {
    let total = 0;
    for (let i = 0; i < saldos.length; i++) {
      saldos[i] = saldos[i] * (1 + grupos[i].taxa) + grupos[i].valor;
      total += saldos[i];
    }
    if (doPlano > 0) {
      saldoPlano = (taxaPlano > 0 ? saldoPlano * (1 + taxaPlano) : saldoPlano) + (mes > inicio ? doPlano : 0);
      total += saldoPlano;
    }
    if (arredondar(total) >= valorAlvo) return mes;
  }
  return null;
}

/**
 * A meta projetada no caminho da cascata: os potes que contam entram desde o
 * mês 1; o dinheiro do plano (`aporteNasMetas`) só a partir de `inicio + 1`,
 * quando os degraus de antes fecharam. `inicio` null = um degrau de antes não
 * fecha nesse ritmo, então a parte do plano nunca chega.
 *
 * `taxaDoPlano` é o rendimento que a parte do plano ganha depois que chega na
 * meta (o do "Guardar", quando ele está marcado pra meta); ausente = não rende.
 *
 * No degrau 4 (`inicio` 0, sem taxa do plano) dá EXATAMENTE `projetarMeta(meta,
 * grupos, aporteNasMetas, hoje)`.
 */
export function projetarMetaNoCaminho(
  meta: Meta,
  grupos: Grupo[],
  aporteNasMetas: number,
  inicio: number | null,
  hoje: Date,
  taxaDoPlano = 0,
): ProjecaoMeta {
  const contribuicoes = grupos
    .filter((g) => g.contaParaMeta)
    .map((g) => ({ valor: emCentavosReais(g.valor), taxa: taxaDoGrupo(g.rendimentoMensal) }));
  const doPlano = inicio === null ? 0 : emCentavosReais(aporteNasMetas);
  const comeco = Math.max(0, inicio ?? 0);
  const taxaPlano = taxaDoGrupo(taxaDoPlano);

  const somaGrupos = contribuicoes.reduce((acc, c) => acc + c.valor, 0);
  const aporteMensal = arredondar(somaGrupos + doPlano);
  const valorAlvo = arredondar(Number.isFinite(meta.valorAlvo) ? meta.valorAlvo : 0);

  const meses = mesesAteOAlvo(contribuicoes, doPlano, comeco, valorAlvo, taxaPlano);
  const semRendimento = mesesAteOAlvo(
    contribuicoes.map((c) => ({ valor: c.valor, taxa: 0 })),
    doPlano,
    comeco,
    valorAlvo,
  );

  return {
    valorAlvo,
    aporteMensal,
    meses,
    mesEstimado: meses === null ? null : mesEstimado(hoje, meses),
    semRendimento,
  };
}

/**
 * Quanto do plano vai pra meta por mês QUANDO a cascata chegar no degrau 4.
 *
 * - No degrau 4 é o aporte de hoje.
 * - Antes, é o aporte do mesmo perfil já com as dívidas caras e médias quitadas
 *   (as parcelas delas voltam pra sobra) e com a reserva cheia — um plano de
 *   degrau 4 gerado pelo próprio motor, com o mesmo ritmo e a mesma escolha
 *   manual. Nada de reler a tabela de ritmo aqui.
 * - No degrau 4, 0 quando o "Guardar" já conta na meta: ele já está na soma
 *   dos potes, e o mesmo real entraria duas vezes.
 * - Antes do degrau 4 o "entra na meta" do Guardar NÃO vale: o dinheiro dele
 *   está pagando dívida ou enchendo a reserva, e contá-lo na meta desde já era
 *   contar o mesmo real duas vezes. Ele chega na meta por aqui, no início dela.
 * - 0 em modo corte.
 */
export function aportePrevistoNasMetas(plano: Plano, grupos: Grupo[] = []): number {
  if (plano.modoCorte) return 0;
  if (plano.degrau === 4) return grupos.some((g) => g.doSistema && g.contaParaMeta) ? 0 : plano.aporte;
  const depois = gerarPlano({
    ...plano.perfil,
    dividas: plano.dividas.baratas,
    guardado: Math.max(plano.perfil.guardado, plano.reserva.alvo),
  });
  return depois.degrau === 4 && !depois.modoCorte ? depois.aporte : 0;
}

/**
 * A projeção da meta de um plano, pelo caminho da cascata — a ÚNICA que o
 * caminho e "Sua meta" usam.
 *
 * - No degrau 4 é `projetarMeta` com a regra da tela (o Guardar marcado entra
 *   como pote; desmarcado, o aporte entra sem rendimento).
 * - Antes, o Guardar sai da lista de potes (o dinheiro dele ainda vai pra
 *   dívida ou reserva) e a parte do plano entra a partir de `inicio`, com o
 *   rendimento do Guardar quando ele está marcado pra meta — o mesmo que ele
 *   renderia no degrau 4.
 */
export function projetarMetaDoPlano(
  plano: Plano,
  meta: Meta,
  grupos: Grupo[],
  inicio: number | null,
  hoje: Date,
): ProjecaoMeta {
  const aporte = aportePrevistoNasMetas(plano, grupos);
  if (plano.degrau === 4) return projetarMetaNoCaminho(meta, grupos, aporte, inicio, hoje);
  const sistema = grupos.find((g) => g.doSistema);
  const taxa = sistema?.contaParaMeta ? taxaDoGrupo(sistema.rendimentoMensal) : 0;
  return projetarMetaNoCaminho(
    meta,
    grupos.filter((g) => !g.doSistema),
    aporte,
    inicio,
    hoje,
    taxa,
  );
}

interface MarcoBruto {
  id: string;
  rotulo: string;
  meses: number | null;
}

/** "Fôlego e reserva prontos" é o único par que tem nome próprio. */
function fundirRotulos(grupo: MarcoBruto[]): string {
  const ids = grupo.map((m) => m.id).join("+");
  if (ids === "folego+reserva") return "Fôlego e reserva prontos";
  const [primeiro, ...resto] = grupo.map((m) => m.rotulo);
  const minusculo = (s: string, id: string) =>
    // o nome da meta é da pessoa: fica como ela escreveu
    id === "meta" ? s : s.charAt(0).toLowerCase() + s.slice(1);
  const seguintes = resto.map((r, i) => minusculo(r, grupo[i + 1].id));
  if (seguintes.length === 1) return `${primeiro} e ${seguintes[0]}`;
  return `${[primeiro, ...seguintes.slice(0, -1)].join(", ")} e ${seguintes.at(-1)}`;
}

/**
 * Os marcos do plano, na ordem da cascata, a partir do degrau de hoje.
 *
 * - O primeiro pendente é o "atual"; os outros, "depois".
 * - Um prazo null vira "sem prazo nesse ritmo" (`semPrazo`), e todos os marcos
 *   seguintes ficam sem prazo — dependem dele. A exceção é a meta que os potes
 *   marcados alcançam sozinhos: eles não esperam a cascata, e ela mostra o mês.
 * - Marcos do mesmo mês se fundem ("Fôlego e reserva prontos").
 * - Com menos de 2 pendentes, o último degrau já resolvido entra como "feito"
 *   ("Fôlego pronto", "Reserva completa"), pra mostrar de onde a pessoa vem.
 * - Modo corte: nenhum marco — não há caminho antes de a conta fechar.
 */
export function marcosDoPlano(plano: Plano, opcoes: OpcoesMarcos): Marco[] {
  return caminhoDoPlano(plano, opcoes).marcos;
}

/** A meta no caminho: a projeção que o marco dela mostra, e de onde ela saiu. */
export interface MetaNoCaminho {
  projecao: ProjecaoMeta;
  /** o mês em que o dinheiro do plano começa a ir pra meta; null = um passo de antes não tem prazo */
  inicio: number | null;
  /** quanto do plano entra por mês a partir do início; 0 = só os potes */
  aporteDoPlano: number;
}

export interface CaminhoDoPlano {
  marcos: Marco[];
  /**
   * a projeção da meta que o marco "meta" usou. "Sua meta" (detalhes) lê
   * DAQUI: recalcular o início por conta própria, a partir dos marcos, errava
   * quando o marco da meta se fundia com outro. null sem meta ou em modo corte.
   */
  meta: MetaNoCaminho | null;
}

/** Os marcos (ver `marcosDoPlano`) junto com a projeção da meta que eles usaram. */
export function caminhoDoPlano(plano: Plano, opcoes: OpcoesMarcos): CaminhoDoPlano {
  if (plano.modoCorte) return { marcos: [], meta: null };
  const { hoje } = opcoes;
  const meta = opcoes.meta ?? plano.perfil.meta;
  const grupos = opcoes.grupos ?? [];
  const { folego, reserva, dividas, degrau } = plano;

  const brutos: MarcoBruto[] = [];
  if (!folego.ok) {
    brutos.push({
      id: "folego",
      rotulo: "Fôlego pronto",
      meses: plano.aporte > 0 ? Math.ceil(folego.falta / plano.aporte) : null,
    });
  }
  if (dividas.caras.length > 0) {
    brutos.push({
      id: "caras",
      rotulo: rotuloDividas(dividas.caras, "Dívidas caras quitadas"),
      meses: dividas.mesesParaQuitarCaras,
    });
  }
  if (!reserva.ok) {
    brutos.push({ id: "reserva", rotulo: `Reserva de ${formatBRL(reserva.alvo)}`, meses: reserva.mesesParaCompletar });
  }
  if (dividas.medias.length > 0) {
    brutos.push({
      id: "medias",
      rotulo: rotuloDividas(dividas.medias, "Dívidas quitadas"),
      meses: dividas.mesesParaQuitarMedias,
    });
  }

  // um marco sem prazo trava os seguintes: eles dependem dele
  const travado = brutos.findIndex((m) => m.meses === null);
  const inicioMeta =
    travado >= 0 ? null : brutos.reduce((max, m) => Math.max(max, m.meses ?? 0), 0);

  let metaNoCaminho: MetaNoCaminho | null = null;
  if (meta) {
    const projecao = projetarMetaDoPlano(plano, meta, grupos, inicioMeta, hoje);
    metaNoCaminho = {
      projecao,
      inicio: inicioMeta,
      aporteDoPlano: inicioMeta === null ? 0 : aportePrevistoNasMetas(plano, grupos),
    };
    brutos.push({ id: "meta", rotulo: rotuloMeta(meta), meses: projecao.meses });
  }

  /*
    Um marco depois do travado depende dele — menos a meta que os potes
    alcançam sozinhos: eles entram desde o mês 1, sem esperar a cascata, e a
    projeção (feita com o início null) já conta só com eles.
  */
  const depende = (k: number) =>
    travado >= 0 && k > travado && !(brutos[k].id === "meta" && brutos[k].meses !== null);

  // funde os vizinhos do mesmo mês (nunca os sem prazo)
  const fundidos: { bruto: MarcoBruto; semPrazo: boolean }[] = [];
  let i = 0;
  while (i < brutos.length) {
    const atual = brutos[i];
    const bloqueado = depende(i);
    if (bloqueado) {
      fundidos.push({ bruto: { ...atual, meses: null }, semPrazo: false });
      i += 1;
      continue;
    }
    if (atual.meses === null) {
      fundidos.push({ bruto: atual, semPrazo: true });
      i += 1;
      continue;
    }
    const grupo = [atual];
    let j = i + 1;
    while (j < brutos.length && brutos[j].meses === atual.meses && !depende(j)) {
      grupo.push(brutos[j]);
      j += 1;
    }
    fundidos.push({
      bruto:
        grupo.length === 1
          ? atual
          : { id: grupo.map((m) => m.id).join("+"), rotulo: fundirRotulos(grupo), meses: atual.meses },
      semPrazo: false,
    });
    i = j;
  }

  const pendentes: Marco[] = fundidos.map(({ bruto, semPrazo }, k) => ({
    id: bruto.id,
    rotulo: bruto.rotulo,
    meses: bruto.meses,
    mes: bruto.meses === null ? null : mesCurto(hoje, bruto.meses),
    mesExtenso: bruto.meses === null ? null : mesEstimado(hoje, bruto.meses),
    estado: k === 0 ? "atual" : "depois",
    semPrazo,
  }));

  if (pendentes.length >= 2 || degrau === 0) return { marcos: pendentes, meta: metaNoCaminho };

  // o último degrau já resolvido: no 1 e no 2 é o fôlego; do 3 em diante, a reserva
  const feito: Marco =
    degrau <= 2
      ? { id: "folego", rotulo: "Fôlego pronto", meses: 0, mes: null, mesExtenso: null, estado: "feito", semPrazo: false }
      : { id: "reserva", rotulo: "Reserva completa", meses: 0, mes: null, mesExtenso: null, estado: "feito", semPrazo: false };
  return { marcos: [feito, ...pendentes], meta: metaNoCaminho };
}
