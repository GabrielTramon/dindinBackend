/*
  GERADO a partir de dindinFrontend/src/domain/categorias.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_DO_ONBOARDING,
  GRUPOS_DO_ONBOARDING,
  SLUGS_CATEGORIA,
  SLUGS_FORA_DO_ONBOARDING,
  categoriaPorSlug,
} from "./categorias";
import { validarPerfil } from "./schema";

/*
  O catálogo e o que a pergunta de gastos fixos oferece são coisas diferentes:
  slug publicado nunca sai do catálogo (já está no localStorage de alguém),
  mas pode sair da pergunta.
*/

describe("financiamento do carro fica só na pergunta de dívidas", () => {
  it("não aparece na pergunta de gastos fixos — a parcela entraria duas vezes no custo do mês", () => {
    expect(CATEGORIAS_DO_ONBOARDING.map((c) => c.slug)).not.toContain("financiamento_veiculo");
    const doGrupo = GRUPOS_DO_ONBOARDING.flatMap((g) => g.categorias.map((c) => c.slug));
    expect(doGrupo).not.toContain("financiamento_veiculo");
  });

  it("mas o slug continua no catálogo, com nome e ícone, e um perfil antigo com ele ainda valida", () => {
    expect(SLUGS_CATEGORIA).toContain("financiamento_veiculo");
    expect(categoriaPorSlug("financiamento_veiculo")).toMatchObject({ nome: "Financiamento do carro", icone: "Car" });
    const antigo = validarPerfil({
      rendaMensal: 3000,
      tipoRenda: "clt",
      idade: 24,
      moradia: "pais",
      custoMoradia: 0,
      gastosFixos: [{ categoria: "financiamento_veiculo", valor: 900 }],
      dividas: [],
      guardado: 0,
    });
    expect(antigo.ok).toBe(true);
  });

  it("toda categoria fora do onboarding existe no catálogo (senão a lista esconde um slug que nem existe)", () => {
    for (const slug of SLUGS_FORA_DO_ONBOARDING) expect(SLUGS_CATEGORIA).toContain(slug);
  });

  it("o resto do grupo transporte continua na pergunta", () => {
    const transporte = GRUPOS_DO_ONBOARDING.find((g) => g.grupo === "transporte")!;
    expect(transporte.categorias.map((c) => c.slug)).toEqual(["transporte_publico", "combustivel", "seguro_veiculo"]);
  });
});
