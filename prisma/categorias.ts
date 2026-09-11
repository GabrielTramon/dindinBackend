/*
  Catálogo de gastos fixos — cópia de dindinFrontend/src/domain/categorias.ts.

  Os dois repositórios são separados, então a lista vive duas vezes. O `slug` é
  o contrato: ele liga a linha do banco à categoria que o app desenha. Mudou
  alguma coisa lá? Atualize aqui e rode `yarn db:seed` — o seed é um upsert por
  slug, então rodar de novo é seguro.

  O ícone é o nome do componente no lucide-react, resolvido no frontend por
  components/categorias/icone-categoria.tsx. Ícone desconhecido cai no padrão.
*/

export type GrupoCategoria =
  | "MORADIA"
  | "CASA"
  | "TRANSPORTE"
  | "SAUDE"
  | "EDUCACAO"
  | "PESSOAL"
  | "OUTROS";

export interface CategoriaSeed {
  slug: string;
  nome: string;
  grupo: GrupoCategoria;
  icone: string;
}

export const CATEGORIAS: readonly CategoriaSeed[] = [
  { slug: "aluguel", nome: "Aluguel", grupo: "MORADIA", icone: "House" },
  { slug: "financiamento_imovel", nome: "Financiamento do imóvel", grupo: "MORADIA", icone: "Landmark" },
  { slug: "condominio", nome: "Condomínio", grupo: "MORADIA", icone: "Building2" },

  { slug: "mercado", nome: "Mercado", grupo: "CASA", icone: "ShoppingCart" },
  { slug: "luz", nome: "Luz", grupo: "CASA", icone: "Zap" },
  { slug: "agua", nome: "Água", grupo: "CASA", icone: "Droplets" },
  { slug: "internet", nome: "Internet", grupo: "CASA", icone: "Wifi" },
  { slug: "gas", nome: "Gás", grupo: "CASA", icone: "Flame" },

  { slug: "transporte_publico", nome: "Transporte", grupo: "TRANSPORTE", icone: "Bus" },
  { slug: "combustivel", nome: "Combustível", grupo: "TRANSPORTE", icone: "Fuel" },
  { slug: "financiamento_veiculo", nome: "Financiamento do carro", grupo: "TRANSPORTE", icone: "Car" },
  { slug: "seguro_veiculo", nome: "Seguro do carro", grupo: "TRANSPORTE", icone: "ShieldCheck" },

  { slug: "plano_saude", nome: "Plano de saúde", grupo: "SAUDE", icone: "HeartPulse" },
  { slug: "academia", nome: "Academia", grupo: "SAUDE", icone: "Dumbbell" },
  { slug: "remedios", nome: "Remédios", grupo: "SAUDE", icone: "Pill" },
  { slug: "terapia", nome: "Terapia", grupo: "SAUDE", icone: "Brain" },

  { slug: "faculdade", nome: "Faculdade", grupo: "EDUCACAO", icone: "GraduationCap" },
  { slug: "escola", nome: "Escola", grupo: "EDUCACAO", icone: "School" },
  { slug: "curso", nome: "Curso", grupo: "EDUCACAO", icone: "BookOpen" },

  { slug: "celular", nome: "Celular", grupo: "PESSOAL", icone: "Smartphone" },
  { slug: "streaming", nome: "Streaming e assinaturas", grupo: "PESSOAL", icone: "Tv" },
  { slug: "pet", nome: "Pet", grupo: "PESSOAL", icone: "PawPrint" },
  { slug: "anuidade_cartao", nome: "Anuidade do cartão", grupo: "PESSOAL", icone: "CreditCard" },

  { slug: "outro", nome: "Outro", grupo: "OUTROS", icone: "Tag" },
];
