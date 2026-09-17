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

export const dividaSchema = z.object({
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

export const perfilSchema = z.object({
  rendaMensal: z
    .number({ error: "Informe quanto entra por mês" })
    .positive({ error: "A renda precisa ser maior que zero" })
    .max(1_000_000, { error: "Confere esse valor? Está muito alto" }),
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
  dividas: z.array(dividaSchema).max(MAX_DIVIDAS, { error: `No máximo ${MAX_DIVIDAS} dívidas` }),
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
