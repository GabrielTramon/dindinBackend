/*
  GERADO a partir de dindinFrontend/src/domain/juros-compostos.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { entradasDoDecimo } from "./decimo-terceiro";
import { evolucaoMensal, jurosCompostos, MAX_MESES_JUROS, porAno, taxaAoMes } from "./juros-compostos";
import { guardarPor } from "./simulador";

/*
  Juros compostos mês a mês: o depósito entra no fim do mês, e o saldo rende
  sobre o mês anterior. É a fórmula de sempre:
    total = inicial × (1 + i)^n + mensal × ((1 + i)^n − 1) / i
*/

/** a fórmula fechada, pra conferir a conta mês a mês */
const formula = (inicial: number, mensal: number, i: number, n: number) =>
  i === 0 ? inicial + mensal * n : inicial * (1 + i) ** n + (mensal * ((1 + i) ** n - 1)) / i;

describe("jurosCompostos", () => {
  it("R$ 1.000 + R$ 100 por mês a 1% ao mês por 1 ano: R$ 2.395,08, sendo R$ 195,08 de juros", () => {
    const r = jurosCompostos({ inicial: 1000, mensal: 100, taxaMensal: 0.01 }, 12);
    expect(r).toMatchObject({ final: 2395.08, investido: 2200, juros: 195.08 });
  });

  it("bate com a fórmula fechada no centavo, até em 30 anos", () => {
    for (const [inicial, mensal, i, n] of [
      [0, 500, 0.008, 360],
      [25000, 0, 0.012, 240],
      [3000, 1795, 0.01, 36],
      [100, 50, 0.0001, 600],
    ] as const) {
      const { final } = jurosCompostos({ inicial, mensal, taxaMensal: i }, n);
      expect(Math.abs(final - formula(inicial, mensal, i, n))).toBeLessThanOrEqual(0.01);
    }
  });

  it("sem taxa, o final é o que entrou: nenhum juro", () => {
    expect(jurosCompostos({ inicial: 1000, mensal: 200 }, 24)).toMatchObject({ final: 5800, investido: 5800, juros: 0 });
  });

  it("a evolução tem o mês 0 (só o inicial) e fecha a soma em toda linha", () => {
    const { meses } = jurosCompostos({ inicial: 1000, mensal: 100, taxaMensal: 0.013 }, 18);
    expect(meses).toHaveLength(19);
    expect(meses[0]).toEqual({ mes: 0, investido: 1000, juros: 0, total: 1000 });
    for (const m of meses) expect(Math.round((m.investido + m.juros) * 100)).toBe(Math.round(m.total * 100));
    // o dinheiro só cresce
    for (let k = 1; k < meses.length; k++) expect(meses[k].total).toBeGreaterThan(meses[k - 1].total);
  });

  it("entrada estranha não quebra: negativo e NaN contam como 0; tempo vira um tempo que existe", () => {
    expect(jurosCompostos({ inicial: -500, mensal: Number.NaN, taxaMensal: -0.1 }, 12)).toMatchObject({
      final: 0,
      investido: 0,
      juros: 0,
    });
    expect(evolucaoMensal({ mensal: 10 }, 2.6)).toHaveLength(4);
    expect(evolucaoMensal({ mensal: 10 }, -3)).toHaveLength(1);
    expect(evolucaoMensal({ mensal: 10 }, 10_000)).toHaveLength(MAX_MESES_JUROS + 1);
  });
});

describe("taxaAoMes", () => {
  it("ao ano vira a EQUIVALENTE: 12% ao ano rendem 0,9489% ao mês, e 1 ano dá exatamente 12%", () => {
    const i = taxaAoMes(0.12, "ano");
    expect(i).toBeCloseTo(0.0094888, 7);
    expect(jurosCompostos({ inicial: 1000, taxaMensal: i }, 12).final).toBe(1120);
    expect(jurosCompostos({ inicial: 1000, taxaMensal: i }, 24).final).toBe(1254.4);
  });

  it("ao mês, é a própria; inválida ou negativa é 0", () => {
    expect(taxaAoMes(0.01, "mes")).toBe(0.01);
    expect(taxaAoMes(-0.01, "mes")).toBe(0);
    expect(taxaAoMes(Number.NaN, "ano")).toBe(0);
  });
});

describe("porAno", () => {
  const meses = (n: number) => jurosCompostos({ mensal: 100 }, n).meses;

  it("o fim de cada ano, e o último mês quando o prazo não fecha o ano", () => {
    expect(porAno(meses(30)).map((m) => m.mes)).toEqual([12, 24, 30]);
    expect(porAno(meses(24)).map((m) => m.mes)).toEqual([12, 24]);
    expect(porAno(meses(6)).map((m) => m.mes)).toEqual([6]);
    expect(porAno(meses(0))).toEqual([]);
  });
});

describe("a calculadora e o simulador do plano fazem a mesma conta", () => {
  it("mesmos dados, mesmo número", () => {
    const decimo = entradasDoDecimo({ valor: 3169, primeiroMes: 4 });
    for (const n of [6, 36, 120]) {
      expect(guardarPor({ inicial: 30000, porMes: 1795, taxaMensal: 0.01, decimo }, n).total).toBe(
        jurosCompostos({ inicial: 30000, mensal: 1795, taxaMensal: 0.01, extra: decimo }, n).final,
      );
    }
  });
});
