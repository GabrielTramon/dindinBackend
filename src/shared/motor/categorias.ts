/*
  GERADO a partir de dindinFrontend/src/domain/categorias.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

/*
  Catálogo de categorias de gasto fixo.

  Este arquivo é a fonte da verdade. O mesmo catálogo é semeado na migration
  do Postgres (dindinBackend/prisma/migrations/.../migration.sql) — os `slug`
  são o contrato entre os dois. Slug publicado nunca muda: ele já está no
  localStorage de quem usou o app. Para aposentar uma categoria, esconda da
  lista, não renomeie o slug.

  Puro de propósito: só dados. O ícone viaja como o nome do componente do
  lucide-react; quem transforma em elemento é <IconeCategoria />.
*/

export type GrupoCategoria =
  | "moradia"
  | "casa"
  | "transporte"
  | "saude"
  | "educacao"
  | "pessoal"
  | "outros";

export interface Categoria {
  slug: string;
  nome: string;
  grupo: GrupoCategoria;
  /** nome do componente no lucide-react */
  icone: string;
}

export const ROTULO_GRUPO: Record<GrupoCategoria, string> = {
  moradia: "Moradia",
  casa: "Casa",
  transporte: "Transporte",
  saude: "Saúde",
  educacao: "Educação",
  pessoal: "Pessoal",
  outros: "Outros",
};

/** Slug da categoria livre: a pessoa dá o nome, o ícone é o padrão. */
export const SLUG_OUTRO = "outro";

/** Ícone de quem não tem ícone próprio. */
export const ICONE_PADRAO = "Tag";

export const CATEGORIAS: readonly Categoria[] = [
  // Moradia é perguntada à parte no onboarding (pergunta 5), porque a resposta
  // sobre onde a pessoa mora decide se a pergunta de custo aparece. Estas
  // entradas existem pro catálogo do banco ficar completo.
  { slug: "aluguel", nome: "Aluguel", grupo: "moradia", icone: "House" },
  { slug: "financiamento_imovel", nome: "Financiamento do imóvel", grupo: "moradia", icone: "Landmark" },
  { slug: "condominio", nome: "Condomínio", grupo: "moradia", icone: "Building2" },

  { slug: "mercado", nome: "Mercado", grupo: "casa", icone: "ShoppingCart" },
  { slug: "luz", nome: "Luz", grupo: "casa", icone: "Zap" },
  { slug: "agua", nome: "Água", grupo: "casa", icone: "Droplets" },
  { slug: "internet", nome: "Internet", grupo: "casa", icone: "Wifi" },
  { slug: "gas", nome: "Gás", grupo: "casa", icone: "Flame" },

  { slug: "transporte_publico", nome: "Transporte", grupo: "transporte", icone: "Bus" },
  { slug: "combustivel", nome: "Combustível", grupo: "transporte", icone: "Fuel" },
  { slug: "financiamento_veiculo", nome: "Financiamento do carro", grupo: "transporte", icone: "Car" },
  { slug: "seguro_veiculo", nome: "Seguro do carro", grupo: "transporte", icone: "ShieldCheck" },

  { slug: "plano_saude", nome: "Plano de saúde", grupo: "saude", icone: "HeartPulse" },
  { slug: "academia", nome: "Academia", grupo: "saude", icone: "Dumbbell" },
  { slug: "remedios", nome: "Remédios", grupo: "saude", icone: "Pill" },
  { slug: "terapia", nome: "Terapia", grupo: "saude", icone: "Brain" },

  { slug: "faculdade", nome: "Faculdade", grupo: "educacao", icone: "GraduationCap" },
  { slug: "escola", nome: "Escola", grupo: "educacao", icone: "School" },
  { slug: "curso", nome: "Curso", grupo: "educacao", icone: "BookOpen" },

  { slug: "celular", nome: "Celular", grupo: "pessoal", icone: "Smartphone" },
  { slug: "streaming", nome: "Streaming e assinaturas", grupo: "pessoal", icone: "Tv" },
  { slug: "pet", nome: "Pet", grupo: "pessoal", icone: "PawPrint" },
  { slug: "anuidade_cartao", nome: "Anuidade do cartão", grupo: "pessoal", icone: "CreditCard" },

  { slug: SLUG_OUTRO, nome: "Outro", grupo: "outros", icone: ICONE_PADRAO },
];

export const SLUGS_CATEGORIA = CATEGORIAS.map((c) => c.slug) as readonly string[];

const POR_SLUG = new Map(CATEGORIAS.map((c) => [c.slug, c]));

export function categoriaPorSlug(slug: string): Categoria | undefined {
  return POR_SLUG.get(slug);
}

/** As que aparecem na pergunta de gastos fixos: moradia já foi perguntada, "outro" tem botão próprio. */
export const CATEGORIAS_DO_ONBOARDING = CATEGORIAS.filter(
  (c) => c.grupo !== "moradia" && c.slug !== SLUG_OUTRO,
);

/** Grupos na ordem do catálogo, cada um com suas categorias do onboarding. */
export const GRUPOS_DO_ONBOARDING: readonly { grupo: GrupoCategoria; categorias: Categoria[] }[] =
  CATEGORIAS_DO_ONBOARDING.reduce<{ grupo: GrupoCategoria; categorias: Categoria[] }[]>((acc, c) => {
    const atual = acc.find((g) => g.grupo === c.grupo);
    if (atual) atual.categorias.push(c);
    else acc.push({ grupo: c.grupo, categorias: [c] });
    return acc;
  }, []);
