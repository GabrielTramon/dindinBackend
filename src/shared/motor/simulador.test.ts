/*
  GERADO a partir de dindinFrontend/src/domain/simulador.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { entradasDoDecimo } from "./decimo-terceiro";
import { gerarPlano } from "./motor";
import { respostaDoPlano, textosSimulador } from "./resposta";
import { guardarPor, MAX_MESES_SIMULADOS, PERIODOS_DA_TABELA, simularNoTempo } from "./simulador";
import type { Perfil } from "./types";
import { formatBRL } from "./format";

/*
  "E se você mantiver?": guardar X por mês durante um tempo, rendendo o que a
  pessoa digitou. Depósito no fim do mês, rendimento sobre o mês anterior —
  a mesma convenção das projeções do plano.
*/

describe("guardarPor", () => {
  it("sem rendimento, é só a soma: R$ 500 por 1 ano = R$ 6.000", () => {
    expect(guardarPor({ porMes: 500 }, 12)).toEqual({ meses: 12, guardado: 6000, rendimento: 0, total: 6000 });
  });

  it("com rendimento, juros compostos: R$ 500 a 1% ao mês por 1 ano", () => {
    // 500 × ((1,01¹² − 1) / 0,01) = 6.341,25
    expect(guardarPor({ porMes: 500, taxaMensal: 0.01 }, 12)).toEqual({
      meses: 12,
      guardado: 6000,
      rendimento: 341.25,
      total: 6341.25,
    });
  });

  it("o 13º entra no mês em que cai, como no plano", () => {
    const decimo = entradasDoDecimo({ valor: 3000, primeiroMes: 4 });
    expect(guardarPor({ porMes: 500, decimo }, 12).guardado).toBe(9000);
    // em 2 anos, dois dezembros (meses 4 e 16)
    expect(guardarPor({ porMes: 500, decimo }, 24).guardado).toBe(18000);
    // antes do primeiro dezembro, nada dele
    expect(guardarPor({ porMes: 500, decimo }, 3).guardado).toBe(1500);
  });

  it("entrada estranha não quebra: valor negativo ou NaN é 0, taxa acima de 5% trava em 5%", () => {
    expect(guardarPor({ porMes: -100 }, 12).total).toBe(0);
    expect(guardarPor({ porMes: Number.NaN }, 12).total).toBe(0);
    expect(guardarPor({ porMes: 100, taxaMensal: 0.2 }, 12)).toEqual(guardarPor({ porMes: 100, taxaMensal: 0.05 }, 12));
  });

  it("tempo fora do horizonte vira um tempo que existe: 0, fração, acima de 50 anos", () => {
    expect(guardarPor({ porMes: 100 }, 0)).toEqual({ meses: 0, guardado: 0, rendimento: 0, total: 0 });
    expect(guardarPor({ porMes: 100 }, 2.6).meses).toBe(3);
    expect(guardarPor({ porMes: 100 }, 10_000).meses).toBe(MAX_MESES_SIMULADOS);
  });
});

describe("simularNoTempo", () => {
  it("a tabela vai de 6 meses a 20 anos, na ordem pedida", () => {
    const tabela = simularNoTempo({ porMes: 1000 }, PERIODOS_DA_TABELA);
    expect(tabela.map((l) => [l.meses, l.total])).toEqual([
      [6, 6000],
      [12, 12000],
      [24, 24000],
      [60, 60000],
      [120, 120000],
      [240, 240000],
    ]);
  });

  it("cada linha é igual à conta feita sozinha (uma passada só não muda o número)", () => {
    const p = { porMes: 750, taxaMensal: 0.008, decimo: entradasDoDecimo({ valor: 2500, primeiroMes: 4 }) };
    const tabela = simularNoTempo(p, PERIODOS_DA_TABELA);
    PERIODOS_DA_TABELA.forEach((m, i) => expect(tabela[i]).toEqual(guardarPor(p, m)));
  });

  it("com o valor e o 13º do plano, 1 ano bate com o 'em 1 ano' do cartão do topo", () => {
    const hoje = new Date(2026, 8, 28);
    const perfil: Perfil = {
      rendaMensal: 3000,
      tipoRenda: "clt",
      idade: 24,
      moradia: "pais",
      custoMoradia: 0,
      gastosFixos: [{ categoria: "mercado", valor: 1000 }],
      dividas: [],
      guardado: 10000,
      decimoTerceiro: true,
    };
    const plano = gerarPlano(perfil, { hoje });
    const r = respostaDoPlano(plano, { simulacoes: [], hoje });
    if (r.modo !== "plano" || r.tempo.tipo !== "ano") throw new Error("esperava 'em 1 ano'");
    const umAno = guardarPor({ porMes: r.valorMes, decimo: entradasDoDecimo(plano.decimoTerceiro) }, 12);
    expect(umAno.total).toBe(r.tempo.valor);
  });
});

describe("textosSimulador", () => {
  it("diz o tempo e separa o que você guardou do que rendeu", () => {
    expect(textosSimulador.em(36)).toBe("Em 3 anos");
    expect(textosSimulador.em(0)).toBe("Escolha um tempo");
    expect(textosSimulador.detalhe(90000, 7200)).toBe(`${formatBRL(90000)} guardados + ${formatBRL(7200)} de rendimento`);
    expect(textosSimulador.detalhe(6000, 0)).toBe(`${formatBRL(6000)} guardados, sem rendimento`);
  });
});
