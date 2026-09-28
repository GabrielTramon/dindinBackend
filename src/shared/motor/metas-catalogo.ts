/*
  GERADO a partir de dindinFrontend/src/domain/metas-catalogo.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import type { Meta, MetaTipo, TipoRenda } from "./types";

/*
  Catálogo da meta principal e dos grupos sugeridos.

  Mesmo desenho de categorias.ts: só dados, o ícone viaja como o nome do
  componente do lucide-react e quem transforma em elemento é a tela. Slug
  publicado nunca muda — ele já está no localStorage de quem usou o app e, no
  caso da meta, o slug É o `MetaTipo` gravado no perfil.

  A lista é fechada de propósito. Meta e grupo são o que a pessoa escolhe antes
  de digitar valor nenhum: catálogo aberto viraria "Outro" em 80% dos casos e a
  tela não teria ícone nem para a meta nem para o grupo.
*/

export interface MetaCatalogo {
  /** o próprio MetaTipo do perfil; é o slug desta lista */
  slug: MetaTipo;
  nome: string;
  /** nome do componente no lucide-react */
  icone: string;
}

/** Ícone da meta sem ícone próprio — a meta "outro", que a pessoa nomeia. */
export const ICONE_META_PADRAO = "Target";

export const METAS: readonly MetaCatalogo[] = [
  { slug: "carro", nome: "Carro", icone: "Car" },
  { slug: "casa", nome: "Casa", icone: "Home" },
  { slug: "liberdade", nome: "Liberdade financeira", icone: "Bird" },
  { slug: "emergencia", nome: "Emergência", icone: "ShieldCheck" },
  { slug: "viagem", nome: "Viagem", icone: "Plane" },
  { slug: "estudos", nome: "Estudos", icone: "GraduationCap" },
  { slug: "outro", nome: "Outro", icone: ICONE_META_PADRAO },
];

// procurado pelo slug, não pela posição: reordenar a lista não pode mudar o fallback
const META_OUTRO: MetaCatalogo = METAS.find((m) => m.slug === "outro") ?? METAS[0];

const METAS_POR_TIPO = new Map(METAS.map((m) => [m.slug, m]));

/**
 * Nunca devolve `undefined`: perfil gravado por uma versão mais nova do app cai
 * em "Outro" em vez de derrubar a tela com um ícone que não existe.
 */
export function metaPorTipo(tipo: MetaTipo): MetaCatalogo {
  return METAS_POR_TIPO.get(tipo) ?? META_OUTRO;
}

/** O que aparece na tela: o nome que a pessoa deu, ou o nome do catálogo. */
export function rotuloMeta(meta: Meta): string {
  const nome = meta.nome?.trim();
  return nome ? nome : metaPorTipo(meta.tipo).nome;
}

export interface GrupoSugerido {
  slug: string;
  nome: string;
  /** nome do componente no lucide-react */
  icone: string;
  /** padrão de "irá fazer parte da somatória para a meta financeira" */
  contaParaMeta: boolean;
  /** o "Guardar" que a cascata preenche; existe um só */
  doSistema?: boolean;
  /** quando presente, a sugestão só aparece pra esses vínculos */
  sugeridoPara?: readonly TipoRenda[];
}

/** Ícone de grupo desconhecido — grupo criado pela pessoa, ou catálogo mais novo que o app. */
export const ICONE_GRUPO_PADRAO = "Tag";

/** O grupo que o sistema cria com o aporte do plano. A pessoa edita o valor; o slug não. */
export const SLUG_GRUPO_SISTEMA = "guardar";

/*
  `contaParaMeta` é só o PADRÃO do cartão: a pessoa liga e desliga o boolean em
  qualquer grupo. Guardar nasce desligado porque o dinheiro dele já está na
  cascata (fôlego, dívida, reserva) — contar de novo na meta seria prometer o
  mesmo real duas vezes. Investimento e Emergência nascem ligados porque é
  literalmente o dinheiro que a pessoa separa pra chegar em algum lugar.
*/
export const GRUPOS_SUGERIDOS: readonly GrupoSugerido[] = [
  { slug: SLUG_GRUPO_SISTEMA, nome: "Guardar", icone: "PiggyBank", contaParaMeta: false, doSistema: true },
  { slug: "investimento", nome: "Investimento", icone: "TrendingUp", contaParaMeta: true },
  { slug: "eu_mesmo", nome: "Eu mesmo", icone: "Smile", contaParaMeta: false },
  { slug: "namoro", nome: "Namoro", icone: "Heart", contaParaMeta: false },
  { slug: "presente", nome: "Presente", icone: "Gift", contaParaMeta: false },
  { slug: "casa", nome: "Casa", icone: "Home", contaParaMeta: false },
  { slug: "viagem", nome: "Viagem", icone: "Plane", contaParaMeta: false },
  { slug: "estudos", nome: "Estudos", icone: "GraduationCap", contaParaMeta: false },
  { slug: "emergencia", nome: "Emergência", icone: "ShieldCheck", contaParaMeta: true },
  // quem é PJ ou informal recebe o bruto na conta: separar o imposto antes de
  // planejar é o que impede o plano de contar dinheiro que já tem dono
  { slug: "imposto", nome: "Imposto", icone: "Receipt", contaParaMeta: false, sugeridoPara: ["pj", "informal"] },
  { slug: "outro", nome: "Outro", icone: ICONE_GRUPO_PADRAO, contaParaMeta: false },
];

const GRUPOS_POR_SLUG = new Map(GRUPOS_SUGERIDOS.map((g) => [g.slug, g]));

export function grupoSugeridoPorSlug(slug: string): GrupoSugerido | undefined {
  return GRUPOS_POR_SLUG.get(slug);
}

/** As sugestões que a tela mostra, sem o grupo do sistema (ele já está na lista da pessoa). */
export function gruposSugeridosPara(tipoRenda: TipoRenda): GrupoSugerido[] {
  return GRUPOS_SUGERIDOS.filter(
    (g) => !g.doSistema && (g.sugeridoPara === undefined || g.sugeridoPara.includes(tipoRenda)),
  );
}
