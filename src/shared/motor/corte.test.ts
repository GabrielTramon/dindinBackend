/*
  GERADO a partir de dindinFrontend/src/domain/corte.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it, vi } from "vitest";
import { formatBRL, formatPct } from "./format";
import { MARGEM_MINIMA_CORTE } from "./config";
import { gerarPlano } from "./motor";
/** Açúcar dos testes: um gasto fixo único, pra cenários que só olham o total. */
const gastos = (valor: number) => (valor > 0 ? [{ categoria: "mercado", valor }] : []);


/*
  config.ts promete: "regra de bolso fica aqui, pra ser ajustada sem mexer na lógica".
  Este arquivo troca MARGEM_MINIMA_CORTE e confere que o número do plano E a frase
  do plano acompanham — os dois vêm da mesma constante.
*/

// forma com string: a constante é tipada como literal 0.1 e a forma `import()` recusaria 0.2
vi.mock("./config", async (importOriginal) => {
  const original = await importOriginal<typeof import("./config")>();
  return { ...original, MARGEM_MINIMA_CORTE: 0.2 };
});

describe("modo corte segue MARGEM_MINIMA_CORTE", () => {
  it("o mock está ativo", () => {
    expect(MARGEM_MINIMA_CORTE).toBe(0.2);
  });

  it("metaCorte e a frase de meta usam a mesma margem", () => {
    const p = gerarPlano({
      rendaMensal: 2000,
      tipoRenda: "clt",
      idade: 22,
      moradia: "pais",
      custoMoradia: 0,
      gastosFixos: gastos(2100),
      dividas: [],
      guardado: 0,
    });
    expect(p.modoCorte).toBe(true);
    expect(p.corte!.deficit).toBe(100);
    expect(p.corte!.metaCorte).toBe(100 + 2000 * 0.2);

    const frase = p.corte!.metaTexto;
    expect(frase).toMatch(/^Meta do mês/);
    expect(p.corte!.sugestoes).not.toContain(frase);
    expect(frase).toContain(formatBRL(500));
    expect(frase).toContain(formatPct(0.2));
    expect(frase).toContain(formatBRL(400));
    expect(frase).not.toContain(formatPct(0.1));
  });
});
