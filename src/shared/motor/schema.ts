/*
  GERADO a partir de dindinFrontend/src/domain/schema.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { z } from "zod";
import { SLUGS_CATEGORIA, SLUG_OUTRO } from "./categorias";
import { MAX_DIVIDAS, MAX_GASTOS_FIXOS } from "./config";

/*
  Validação do perfil. Mensagens em pt-BR porque aparecem na tela.
  O mesmo schema vale pro onboarding e pra qualquer calculadora pública.
*/

export const TIPOS_RENDA = ["clt", "pj", "informal"] as const;
export const MORADIAS = ["pais", "aluguel", "dividido", "propria", "financiada"] as const;
export const TIPOS_DIVIDA = [
  "rotativo",
  "cheque_especial",
  "emprestimo",
  "financiamento",
  "outra",
] as const;

/** moradias em que a pergunta de custo é pulada e o custo é 0 */
export const MORADIAS_SEM_CUSTO = ["pais", "propria"] as const;

export const RITMOS = ["leve", "equilibrado", "acelerado"] as const;
export const RENDAS_INFORMADAS = ["bruta", "liquida"] as const;
export const METAS_TIPO = [
  "carro",
  "casa",
  "liberdade",
  "emergencia",
  "viagem",
  "estudos",
  "outro",
] as const;

export const metaSchema = z
  .object({
    tipo: z.enum(METAS_TIPO, { error: "Escolha a sua meta" }),
    nome: z.string().trim().max(40, { error: "No máximo 40 caracteres" }).optional(),
    valorAlvo: z
      .number({ error: "Informe quanto você quer juntar" })
      .positive({ error: "O valor precisa ser maior que zero" })
      .max(100_000_000, { error: "Confere esse valor? Está muito alto" }),
  })
  // meta "outro" sem nome vira uma barra de progresso sem título na tela
  .refine((m) => m.tipo !== "outro" || (m.nome !== undefined && m.nome.length > 0), {
    error: "Dê um nome pra essa meta",
    path: ["nome"],
  });

/*
  Os campos da dívida, sem a trava parcela × saldo. É o que o PERFIL SALVO usa:
  um plano gravado antes da trava existir, com a parcela maior que o saldo, não
  pode sumir da tela no F5 — o motor já limita a parcela ao saldo na conta.
*/
const dividaCamposSchema = z.object({
  tipo: z.enum(TIPOS_DIVIDA, { error: "Escolha o tipo da dívida" }),
  saldo: z
    .number({ error: "Informe quanto você deve" })
    .positive({ error: "O saldo precisa ser maior que zero" })
    .max(10_000_000, { error: "Confere esse valor? Está muito alto" }),
  parcela: z
    .number({ error: "Informe a parcela" })
    .nonnegative({ error: "A parcela não pode ser negativa" })
    .max(1_000_000, { error: "Confere esse valor? Está muito alto" })
    .optional(),
  taxaAnual: z
    .number()
    .min(0, { error: "A taxa não pode ser negativa" })
    .max(20, { error: "Taxa acima de 2.000% ao ano? Confere o valor" })
    .optional(),
});

/**
 * A dívida como a pessoa DIGITA (onboarding, API): os campos + a trava da
 * parcela. Não é o que valida o perfil salvo — ver dividaCamposSchema.
 */
export const dividaSchema = z
  .object({
    tipo: z.enum(TIPOS_DIVIDA, { error: "Escolha o tipo da dívida" }),
    saldo: z
      .number({ error: "Informe quanto você deve" })
      .positive({ error: "O saldo precisa ser maior que zero" })
      .max(10_000_000, { error: "Confere esse valor? Está muito alto" }),
    parcela: z
      .number({ error: "Informe a parcela" })
      .nonnegative({ error: "A parcela não pode ser negativa" })
      .max(1_000_000, { error: "Confere esse valor? Está muito alto" })
      .optional(),
    taxaAnual: z
      .number()
      .min(0, { error: "A taxa não pode ser negativa" })
      .max(20, { error: "Taxa acima de 2.000% ao ano? Confere o valor" })
      .optional(),
  })
  // quase sempre é número trocado entre os dois campos; sem isso o plano
  // desconta todo mês uma parcela maior do que a dívida inteira
  .refine((d) => d.parcela === undefined || d.parcela <= d.saldo, {
    error: "A parcela está maior que o total da dívida. Confere os dois valores?",
    path: ["parcela"],
  });

export const gastoFixoSchema = z
  .object({
    categoria: z.string({ error: "Escolha a categoria" }).refine((s) => SLUGS_CATEGORIA.includes(s), {
      error: "Categoria desconhecida",
    }),
    nome: z
      .string()
      .trim()
      .max(40, { error: "No máximo 40 caracteres" })
      .optional(),
    valor: z
      .number({ error: "Informe quanto sai por mês" })
      .positive({ error: "O valor precisa ser maior que zero" })
      .max(1_000_000, { error: "Confere esse valor? Está muito alto" }),
  })
  // categoria livre precisa de nome: sem ele a linha aparece como "Outro" e não diz nada
  .refine((g) => g.categoria !== SLUG_OUTRO || (g.nome !== undefined && g.nome.length > 0), {
    error: "Dê um nome pra esse gasto",
    path: ["nome"],
  });

/*
  Campos opcionais NUNCA levam `.default()`: o default apareceria em todo perfil
  validado, mudaria o snapshot de quem já tem plano gravado e criaria uma versão
  nova pra base inteira sem ninguém ter mudado nada.
*/
export const perfilSchema = z.object({
  rendaMensal: z
    .number({ error: "Informe quanto entra por mês" })
    .positive({ error: "A renda precisa ser maior que zero" })
    .max(1_000_000, { error: "Confere esse valor? Está muito alto" }),
  rendaInformada: z.enum(RENDAS_INFORMADAS).optional(),
  salarioBruto: z
    .number({ error: "Informe o seu salário bruto" })
    .positive({ error: "O salário precisa ser maior que zero" })
    .max(1_000_000, { error: "Confere esse valor? Está muito alto" })
    .optional(),
  dependentes: z
    .number()
    .int({ error: "Em números inteiros" })
    .min(0, { error: "Não pode ser negativo" })
    .max(10, { error: "No máximo 10" })
    .optional(),
  competenciaTabela: z.string().optional(),
  ritmo: z.enum(RITMOS).optional(),
  aporteEscolhido: z
    .number()
    .nonnegative({ error: "Não pode ser negativo" })
    .max(1_000_000, { error: "Confere esse valor? Está muito alto" })
    .optional(),
  meta: metaSchema.optional(),
  tipoRenda: z.enum(TIPOS_RENDA, { error: "Escolha como é a sua renda" }),
  idade: z
    .number({ error: "Informe sua idade" })
    .int({ error: "Idade em anos inteiros" })
    .min(14, { error: "A partir de 14 anos" })
    .max(100, { error: "Confere a idade?" }),
  moradia: z.enum(MORADIAS, { error: "Escolha onde você mora" }),
  custoMoradia: z
    .number({ error: "Informe quanto sai de moradia" })
    .nonnegative({ error: "Não pode ser negativo" })
    .max(1_000_000, { error: "Confere esse valor? Está muito alto" }),
  gastosFixos: z
    .array(gastoFixoSchema)
    .max(MAX_GASTOS_FIXOS, { error: `No máximo ${MAX_GASTOS_FIXOS} gastos fixos` }),
  // sem a trava parcela × saldo: ela mora no dividaSchema, que o onboarding usa linha a linha
  dividas: z.array(dividaCamposSchema).max(MAX_DIVIDAS, { error: `No máximo ${MAX_DIVIDAS} dívidas` }),
  guardado: z
    .number({ error: "Informe quanto você tem guardado (pode ser 0)" })
    .nonnegative({ error: "Não pode ser negativo" })
    .max(100_000_000, { error: "Confere esse valor? Está muito alto" }),
});

export type PerfilInput = z.input<typeof perfilSchema>;
export type PerfilValidado = z.output<typeof perfilSchema>;

/** Resultado amigável pra UI: ou o perfil válido, ou erros por campo. */
export function validarPerfil(
  dados: unknown,
): { ok: true; perfil: PerfilValidado } | { ok: false; erros: Record<string, string> } {
  const r = perfilSchema.safeParse(dados);
  if (r.success) return { ok: true, perfil: r.data };
  const erros: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const chave = issue.path.map(String).join(".") || "_";
    if (!(chave in erros)) erros[chave] = issue.message;
  }
  return { ok: false, erros };
}
