/*
  GERADO a partir de dindinFrontend/src/domain/projecao.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { aporteParaMeta, mesesParaMeta, projetarSaldo, serieProjecao } from "./projecao";

/*
  Projeções de meta. Convenção: aporte no fim do mês, depois do rendimento.
  O contrato que importa pro simulador: o aporte que `aporteParaMeta` devolve
  pra N meses tem que chegar no alvo em exatamente N meses — nem N−1, nem N+1.
*/

describe("projetarSaldo", () => {
  it("com taxa 0 é linear: saldo inicial + aporte × meses", () => {
    expect(projetarSaldo({ saldoInicial: 100, aporteMensal: 50, taxaAnual: 0 }, 10)).toBe(600);
    expect(projetarSaldo({ aporteMensal: 33.33, taxaAnual: 0 }, 3)).toBe(99.99);
  });

  it("0 meses devolve o saldo inicial", () => {
    expect(projetarSaldo({ saldoInicial: 250, aporteMensal: 100, taxaAnual: 0.12 }, 0)).toBe(250);
  });

  it("com juros rende mais do que a soma dos aportes", () => {
    const comJuros = projetarSaldo({ aporteMensal: 100, taxaAnual: 0.12 }, 12);
    expect(comJuros).toBeGreaterThan(1200);
    expect(comJuros).toBeLessThan(1300);
  });
});

describe("mesesParaMeta", () => {
  it("saldoInicial ≥ alvo → 0", () => {
    expect(mesesParaMeta({ saldoInicial: 1000, aporteMensal: 0, taxaAnual: 0 }, 1000)).toBe(0);
    expect(mesesParaMeta({ saldoInicial: 5000, aporteMensal: 100 }, 1000)).toBe(0);
  });

  it("aporte 0 e taxa 0 → null (nunca chega)", () => {
    expect(mesesParaMeta({ saldoInicial: 100, aporteMensal: 0, taxaAnual: 0 }, 1000)).toBeNull();
    expect(mesesParaMeta({ aporteMensal: 0, taxaAnual: 0 }, 1)).toBeNull();
  });

  it("aporte 0 com saldo rendendo chega pelo juro", () => {
    // 1000 a 12% a.a. dobra em ~6 anos
    const m = mesesParaMeta({ saldoInicial: 1000, aporteMensal: 0, taxaAnual: 0.12 }, 2000);
    expect(m).not.toBeNull();
    expect(m!).toBeGreaterThan(60);
    expect(m!).toBeLessThan(84);
  });

  it("sem taxa, é o teto do alvo dividido pelo aporte", () => {
    expect(mesesParaMeta({ aporteMensal: 250, taxaAnual: 0 }, 1000)).toBe(4);
    expect(mesesParaMeta({ aporteMensal: 300, taxaAnual: 0 }, 1000)).toBe(4);
    expect(mesesParaMeta({ aporteMensal: 334, taxaAnual: 0 }, 1000)).toBe(3);
  });

  it("null quando passa de 100 anos", () => {
    expect(mesesParaMeta({ aporteMensal: 0.01, taxaAnual: 0 }, 1_000_000)).toBeNull();
  });
});

describe("aporteParaMeta", () => {
  it("meses ≤ 0 devolve a diferença (nunca negativa)", () => {
    expect(aporteParaMeta(1000, 0)).toBe(1000);
    expect(aporteParaMeta(1000, -3, { saldoInicial: 400 })).toBe(600);
    expect(aporteParaMeta(1000, 0, { saldoInicial: 5000 })).toBe(0);
  });

  it("taxa 0 é o alvo dividido pelos meses", () => {
    expect(aporteParaMeta(1000, 4, { taxaAnual: 0 })).toBe(250);
    expect(aporteParaMeta(1000, 4, { taxaAnual: 0, saldoInicial: 200 })).toBe(200);
  });

  it("0 quando o saldo inicial já chega sozinho", () => {
    expect(aporteParaMeta(1000, 12, { saldoInicial: 1000, taxaAnual: 0 })).toBe(0);
    expect(aporteParaMeta(1000, 12, { saldoInicial: 950, taxaAnual: 0.12 })).toBe(0);
  });

  it("com juros o aporte é menor do que sem juros", () => {
    expect(aporteParaMeta(12000, 12, { taxaAnual: 0.12 })).toBeLessThan(1000);
    expect(aporteParaMeta(12000, 12, { taxaAnual: 0 })).toBe(1000);
  });
});

describe("consistência mesesParaMeta ↔ aporteParaMeta", () => {
  const casos: { alvo: number; meses: number; saldoInicial: number; taxaAnual: number }[] = [];
  for (const alvo of [1000, 5000, 12345.67, 100000])
    for (const meses of [1, 3, 6, 7, 12, 24, 37, 120])
      for (const saldoInicial of [0, 500, 999.99])
        for (const taxaAnual of [0, 0.08, 0.12, 0.1325]) casos.push({ alvo, meses, saldoInicial, taxaAnual });

  it("o aporte calculado pra N meses chega no alvo em N meses — não em N−1 nem em N+1", () => {
    let verificados = 0;
    for (const { alvo, meses, saldoInicial, taxaAnual } of casos) {
      const aporte = aporteParaMeta(alvo, meses, { saldoInicial, taxaAnual });
      if (aporte === 0) continue; // o saldo inicial chega sozinho; não há o que verificar
      const rotulo = `alvo ${alvo}, ${meses} meses, saldo ${saldoInicial}, taxa ${taxaAnual} → aporte ${aporte}`;
      const chegaEm = mesesParaMeta({ saldoInicial, aporteMensal: aporte, taxaAnual }, alvo);
      // nunca chega DEPOIS de N
      expect(chegaEm, rotulo).not.toBeNull();
      expect(chegaEm!, rotulo).toBeLessThanOrEqual(meses);
      expect(projetarSaldo({ saldoInicial, aporteMensal: aporte, taxaAnual }, meses), rotulo).toBeGreaterThanOrEqual(alvo);
      // caso degenerado: faltam centavos e o piso de R$ 0,01 chega antes de N — só aí é aceitável chegar antes
      if (aporte < 1) continue;
      verificados++;
      expect(chegaEm, rotulo).toBe(meses);
      if (meses > 1) {
        expect(projetarSaldo({ saldoInicial, aporteMensal: aporte, taxaAnual }, meses - 1), rotulo).toBeLessThan(alvo);
      }
    }
    expect(verificados).toBeGreaterThan(300);
  });

  it("mesesParaMeta compara em centavos, como projetarSaldo mostra", () => {
    // (12.345,67 − 999,99) / 37 = 306,64 exatos. Somando 37 vezes em float dá 12.345,669999…;
    // projetarSaldo mostra 12.345,67 (alvo batido) e mesesParaMeta não pode dizer 38.
    const p = { saldoInicial: 999.99, aporteMensal: 306.64, taxaAnual: 0 };
    expect(aporteParaMeta(12345.67, 37, p)).toBe(306.64);
    expect(projetarSaldo(p, 37)).toBe(12345.67);
    expect(mesesParaMeta(p, 12345.67)).toBe(37);
  });

  it("o aporte devolvido não passa de 1 centavo acima do necessário", () => {
    // taxa 0: 1000 em 3 meses precisa de 333,33…; o aporte tem que ser 333,34, não 333,33 nem 334
    const a = aporteParaMeta(1000, 3, { taxaAnual: 0 });
    expect(a).toBeGreaterThanOrEqual(1000 / 3);
    expect(a).toBeLessThan(1000 / 3 + 0.01);
  });
});

describe("serieProjecao", () => {
  const params = [
    { saldoInicial: 0, aporteMensal: 100, taxaAnual: 0.12 },
    { saldoInicial: 250, aporteMensal: 33.33, taxaAnual: 0.12 },
    { saldoInicial: 999.99, aporteMensal: 12.34, taxaAnual: 0.0825 },
    { saldoInicial: 0.01, aporteMensal: 0.07, taxaAnual: 0.1325 },
    { saldoInicial: 123.45, aporteMensal: 678.9, taxaAnual: 0.3 },
    { saldoInicial: 10, aporteMensal: 10.005, taxaAnual: 0.12 },
    { saldoInicial: 0, aporteMensal: 0, taxaAnual: 0.12 },
  ];

  it("tem meses + 1 pontos, começando no mês 0 com o saldo inicial", () => {
    const s = serieProjecao({ saldoInicial: 500, aporteMensal: 100, taxaAnual: 0.12 }, 12);
    expect(s).toHaveLength(13);
    expect(s[0]).toEqual({ mes: 0, saldo: 500, aportado: 500, rendimento: 0 });
    expect(s.map((p) => p.mes)).toEqual(Array.from({ length: 13 }, (_, i) => i));
  });

  it("rendimento === saldo − aportado em todo ponto", () => {
    for (const p of params) {
      for (const meses of [1, 12, 60, 240]) {
        const serie = serieProjecao(p, meses);
        for (const ponto of serie) {
          const diff = Math.round((ponto.saldo - ponto.aportado) * 100) / 100;
          expect(ponto.rendimento, `${JSON.stringify(p)} mês ${ponto.mes}`).toBeCloseTo(diff, 2);
        }
      }
    }
  });

  it("com taxa 0 o rendimento é 0 e o saldo é linear", () => {
    const serie = serieProjecao({ saldoInicial: 100, aporteMensal: 50, taxaAnual: 0 }, 6);
    for (const ponto of serie) {
      expect(ponto.rendimento).toBe(0);
      expect(ponto.saldo).toBe(100 + 50 * ponto.mes);
      expect(ponto.aportado).toBe(ponto.saldo);
    }
  });

  it("o último ponto bate com projetarSaldo", () => {
    for (const p of params) {
      const serie = serieProjecao(p, 36);
      expect(serie[36].saldo).toBe(projetarSaldo(p, 36));
    }
  });

  it("saldo e aportado nunca caem (aporte ≥ 0, taxa ≥ 0)", () => {
    for (const p of params) {
      const serie = serieProjecao(p, 24);
      for (let i = 1; i < serie.length; i++) {
        expect(serie[i].saldo).toBeGreaterThanOrEqual(serie[i - 1].saldo);
        expect(serie[i].aportado).toBeGreaterThanOrEqual(serie[i - 1].aportado);
        expect(serie[i].rendimento).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
