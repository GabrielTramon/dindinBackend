/*
  GERADO a partir de dindinFrontend/src/domain/motor.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { avaliarDividas, gerarPlano, simularQuitacao, taxaMensal } from "./motor";
import type { Perfil } from "./types";
/** Açúcar dos testes: um gasto fixo único, pra cenários que só olham o total. */
const gastos = (valor: number) => (valor > 0 ? [{ categoria: "mercado", valor }] : []);


/*
  Teste de fumaça do motor. Cenários da persona (18–30, começando a trabalhar).
  A suíte completa com os 12 cenários do roteiro vive em cascata.test.ts.
*/

const base: Perfil = {
  rendaMensal: 2500,
  tipoRenda: "clt",
  idade: 22,
  moradia: "pais",
  custoMoradia: 0,
  gastosFixos: gastos(900),
  dividas: [],
  guardado: 0,
};

describe("taxaMensal", () => {
  it("converte 12% a.a. em ~0,95% a.m.", () => {
    expect(taxaMensal(0.12)).toBeCloseTo(0.009489, 5);
  });
});

describe("avaliarDividas", () => {
  it("classifica e ordena da mais cara pra mais barata", () => {
    const [primeira, segunda] = avaliarDividas([
      { tipo: "financiamento", saldo: 10000 },
      { tipo: "rotativo", saldo: 500 },
    ]);
    expect(primeira.tipo).toBe("rotativo");
    expect(primeira.classe).toBe("cara");
    expect(segunda.classe).toBe("media");
  });

  it("ignora dívida com saldo zero", () => {
    expect(avaliarDividas([{ tipo: "rotativo", saldo: 0 }])).toHaveLength(0);
  });
});

describe("simularQuitacao", () => {
  it("quita um rotativo pequeno em poucos meses", () => {
    const [d] = avaliarDividas([{ tipo: "rotativo", saldo: 2000 }]);
    const meses = simularQuitacao([d], 840);
    expect(meses).not.toBeNull();
    expect(meses!).toBeGreaterThan(0);
    expect(meses!).toBeLessThanOrEqual(6);
  });

  it("devolve null quando o aporte não cobre os juros", () => {
    const [d] = avaliarDividas([{ tipo: "rotativo", saldo: 20000 }]);
    expect(simularQuitacao([d], 100)).toBeNull();
  });
});

describe("gerarPlano — cascata", () => {
  it("mora com os pais, sem dívida, sem reserva → degrau 0, fôlego primeiro", () => {
    const p = gerarPlano(base);
    expect(p.modoCorte).toBe(false);
    expect(p.resumo.excedente).toBe(1600);
    expect(p.degrau).toBe(0);
    expect(p.folego.alvo).toBe(900);
    expect(p.aporte).toBe(960);
    expect(p.livre).toBe(640);
    expect(p.alocacoes[0]).toMatchObject({ destino: "folego", valor: 900 });
    expect(p.alocacoes[1]).toMatchObject({ destino: "reserva", valor: 60 });
    expect(p.decisao.titulo).toContain("fôlego");
  });

  it("rotativo com fôlego ok → degrau 1, 100% do aporte na dívida", () => {
    const p = gerarPlano({
      ...base,
      rendaMensal: 3000,
      moradia: "aluguel",
      custoMoradia: 1000,
      gastosFixos: gastos(800),
      dividas: [{ tipo: "rotativo", saldo: 2000 }],
      guardado: 1000,
    });
    expect(p.degrau).toBe(1);
    expect(p.folego.ok).toBe(true);
    expect(p.aporte).toBe(840);
    expect(p.alocacoes).toHaveLength(1);
    expect(p.alocacoes[0].destino).toBe("divida_cara");
    expect(p.dividas.mesesParaQuitarCaras).not.toBeNull();
    expect(p.decisao.titulo).toContain("rotativo");
  });

  it("custos maiores que a renda → modo corte, aporte zero", () => {
    const p = gerarPlano({ ...base, rendaMensal: 1500, gastosFixos: gastos(1700) });
    expect(p.modoCorte).toBe(true);
    expect(p.aporte).toBe(0);
    expect(p.livre).toBe(0);
    expect(p.alocacoes).toHaveLength(0);
    expect(p.corte?.deficit).toBe(200);
    expect(p.corte?.metaCorte).toBe(350);
  });

  it("autônomo usa reserva de 6 meses", () => {
    const p = gerarPlano({ ...base, tipoRenda: "pj", guardado: 5000 });
    expect(p.reserva.multiplicador).toBe(6);
    expect(p.reserva.alvo).toBe(5400);
    expect(p.degrau).toBe(2);
  });

  it("só financiamento, reserva completa → degrau 3", () => {
    const p = gerarPlano({
      ...base,
      dividas: [{ tipo: "financiamento", saldo: 15000, parcela: 500 }],
      guardado: 10000,
    });
    expect(p.dividas.medias).toHaveLength(1);
    expect(p.dividas.caras).toHaveLength(0);
    expect(p.degrau).toBe(3);
    expect(p.alocacoes[0].destino).toBe("divida_media");
  });

  it("tudo resolvido → degrau 4, aporte vai pra metas", () => {
    const p = gerarPlano({ ...base, guardado: 10000 });
    expect(p.degrau).toBe(4);
    expect(p.alocacoes[0].destino).toBe("metas");
    expect(p.decisao.titulo).toContain("meta");
  });
});
