/*
  GERADO a partir de dindinFrontend/src/domain/quitacao.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { MESES_SIMULACAO_MAX } from "./config";
import { avaliarDividas, simularQuitacao, simularQuitacaoDetalhada, taxaMensal } from "./motor";
import type { DividaAvaliada } from "./types";

/*
  simularQuitacao: casos calculados à mão. Convenção do motor, por mês:
    1. cada dívida rende juros e paga a própria parcela;
    2. o extra vai pra primeira da lista que ainda deve (a lista já vem da mais cara);
    3. dívida que zera libera a parcela dela pras seguintes (bola de neve).
*/

/** 1% a.m. exato em juros compostos: (1,01)^12 − 1 ≈ 12,68% a.a. */
const UM_PORCENTO_AM = 1.01 ** 12 - 1;

function divida(over: Partial<DividaAvaliada> & { saldo: number }): DividaAvaliada {
  const taxaAnual = over.taxaAnual ?? 0;
  return {
    tipo: "outra",
    classe: "media",
    taxaAnual,
    jurosMensais: over.saldo * taxaMensal(taxaAnual),
    ...over,
  };
}

describe("simularQuitacao", () => {
  it("taxa 1% a.m. bate com 1% ao mês", () => {
    expect(taxaMensal(UM_PORCENTO_AM)).toBeCloseTo(0.01, 12);
  });

  it("sem juros: saldo 1000, extra 250 → 4 meses", () => {
    // 1000 → 750 → 500 → 250 → 0
    expect(simularQuitacao([divida({ saldo: 1000, taxaAnual: 0 })], 250)).toBe(4);
  });

  it("com juros (1% a.m.): saldo 1000, extra 350 → 3 meses", () => {
    // mês 1: 1000 × 1,01 = 1010,00 − 350 = 660,00
    // mês 2:  660 × 1,01 =  666,60 − 350 = 316,60
    // mês 3: 316,6 × 1,01 = 319,77 − 350 → 0  ✓
    expect(simularQuitacao([divida({ saldo: 1000, taxaAnual: UM_PORCENTO_AM })], 350)).toBe(3);
  });

  it("com juros (1% a.m.): saldo 1000, extra 340 → 4 meses (sobra R$ 0,07 no 3º mês)", () => {
    // mês 1: 1010,00 − 340 = 670,00
    // mês 2: 676,70 − 340 = 336,70
    // mês 3: 340,07 − 340 = 0,07  (ainda deve)
    // mês 4: 0,07 × 1,01 − 340 → 0  ✓
    expect(simularQuitacao([divida({ saldo: 1000, taxaAnual: UM_PORCENTO_AM })], 340)).toBe(4);
  });

  it("parcela + extra: saldo 1000, parcela 100, extra 150 → 4 meses", () => {
    // 250 por mês: 1000 → 750 → 500 → 250 → 0
    expect(simularQuitacao([divida({ saldo: 1000, taxaAnual: 0, parcela: 100 })], 150)).toBe(4);
  });

  it("parcela sozinha, sem extra, também quita", () => {
    expect(simularQuitacao([divida({ saldo: 1000, taxaAnual: 0, parcela: 500 })], 0)).toBe(2);
  });

  it("null quando os juros superam o pagamento", () => {
    // 10.000 a 1% a.m. rende 100/mês; pagando 50, o saldo só cresce
    expect(simularQuitacao([divida({ saldo: 10000, taxaAnual: UM_PORCENTO_AM })], 50)).toBeNull();
    // parcela 40 + extra 50 = 90 < 100 → também nunca
    expect(
      simularQuitacao([divida({ saldo: 10000, taxaAnual: UM_PORCENTO_AM, parcela: 40 })], 50),
    ).toBeNull();
  });

  it("null quando pagamento é exatamente igual aos juros (saldo não cai)", () => {
    expect(simularQuitacao([divida({ saldo: 10000, taxaAnual: UM_PORCENTO_AM })], 100)).toBeNull();
  });

  it("null (e termina) quando o saldo cai devagar demais pra caber no horizonte", () => {
    // 10 milhões a R$ 1 por mês: cai todo mês, mas passa do teto de simulação
    const inicio = Date.now();
    expect(simularQuitacao([divida({ saldo: 10_000_000, taxaAnual: 0 })], 1)).toBeNull();
    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(MESES_SIMULACAO_MAX).toBeLessThan(10_000_000);
  });

  it("lista vazia → 0", () => {
    expect(simularQuitacao([], 500)).toBe(0);
    expect(simularQuitacao([], 0)).toBe(0);
  });

  it("extra negativo conta como zero", () => {
    expect(simularQuitacao([divida({ saldo: 1000, taxaAnual: 0, parcela: 250 })], -100)).toBe(4);
  });

  it("bola de neve: a parcela da primeira reforça a segunda quando ela zera", () => {
    // A: 1000, parcela 200 · B: 1000, sem parcela · extra 100 · sem juros
    // meses 1–3: A cai 300/mês (200 parcela + 100 extra) → 700, 400, 100
    // mês 4: parcela zera A; o extra (100) já vai pra B → 900. A libera 200.
    // meses 5–7: B cai 300/mês (100 extra + 200 da parcela liberada) → 600, 300, 0
    const comParcela = simularQuitacao(
      [divida({ saldo: 1000, taxaAnual: 0, parcela: 200 }), divida({ saldo: 1000, taxaAnual: 0 })],
      100,
    );
    // sem parcela: 100/mês pra 2000 no total → 20 meses
    const semParcela = simularQuitacao(
      [divida({ saldo: 1000, taxaAnual: 0 }), divida({ saldo: 1000, taxaAnual: 0 })],
      100,
    );
    expect(comParcela).toBe(7);
    expect(semParcela).toBe(20);
    expect(comParcela!).toBeLessThan(semParcela!);
    // sem o reforço, B levaria 9 meses depois do 4º (900/100) → 13 no total; 7 prova a bola de neve
    expect(comParcela!).toBeLessThan(13);
  });

  it("funciona com o que sai de avaliarDividas (ordenado da mais cara)", () => {
    const avaliadas = avaliarDividas([
      { tipo: "financiamento", saldo: 2000, parcela: 300 },
      { tipo: "rotativo", saldo: 500 },
    ]);
    expect(avaliadas[0].tipo).toBe("rotativo");
    const meses = simularQuitacao(avaliadas, 400);
    expect(meses).not.toBeNull();
    expect(meses!).toBeGreaterThan(1);
    expect(meses!).toBeLessThan(24);
  });

  it("não muta as dívidas recebidas", () => {
    const d = [divida({ saldo: 1000, taxaAnual: UM_PORCENTO_AM, parcela: 100 })];
    const copia = structuredClone(d);
    simularQuitacao(d, 200);
    expect(d).toEqual(copia);
  });
});

/*
  Os dois jeitos de não ter prazo são coisas diferentes na tela: "os juros
  crescem mais rápido do que você paga" é falso quando o saldo cai — só que
  devagar demais pro horizonte da conta. O texto afirmava a primeira causa nos
  dois casos.
*/
describe("simularQuitacaoDetalhada — por que não zerou", () => {
  it("juros: o saldo não cai", () => {
    expect(
      simularQuitacaoDetalhada([divida({ saldo: 10000, taxaAnual: UM_PORCENTO_AM })], 50),
    ).toEqual({ meses: null, motivo: "juros" });
    // pagamento exatamente igual aos juros também é "juros": o saldo empaca
    expect(
      simularQuitacaoDetalhada([divida({ saldo: 10000, taxaAnual: UM_PORCENTO_AM })], 100),
    ).toEqual({ meses: null, motivo: "juros" });
  });

  it("horizonte: o saldo cai todo mês, mas não cabe no teto de simulação", () => {
    expect(simularQuitacaoDetalhada([divida({ saldo: 10_000_000, taxaAnual: 0 })], 1)).toEqual({
      meses: null,
      motivo: "horizonte",
    });
    // 600 parcelas de 1 zeram; 601 não
    expect(simularQuitacaoDetalhada([divida({ saldo: MESES_SIMULACAO_MAX, taxaAnual: 0 })], 1)).toEqual({
      meses: MESES_SIMULACAO_MAX,
      motivo: null,
    });
    expect(
      simularQuitacaoDetalhada([divida({ saldo: MESES_SIMULACAO_MAX + 1, taxaAnual: 0 })], 1),
    ).toEqual({ meses: null, motivo: "horizonte" });
  });

  it("quitou: motivo null", () => {
    expect(simularQuitacaoDetalhada([divida({ saldo: 1000, taxaAnual: 0 })], 250)).toEqual({
      meses: 4,
      motivo: null,
    });
    expect(simularQuitacaoDetalhada([], 0)).toEqual({ meses: 0, motivo: null });
  });

  it("simularQuitacao continua devolvendo só os meses (contrato usado pelo backend)", () => {
    const caso: DividaAvaliada[] = [divida({ saldo: 1000, taxaAnual: 0 })];
    expect(simularQuitacao(caso, 250)).toBe(simularQuitacaoDetalhada(caso, 250).meses);
    const semSaida: DividaAvaliada[] = [divida({ saldo: 10000, taxaAnual: UM_PORCENTO_AM })];
    expect(simularQuitacao(semSaida, 50)).toBeNull();
  });
});
