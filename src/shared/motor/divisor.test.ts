/*
  GERADO a partir de dindinFrontend/src/domain/divisor.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import {
  limitesDoDivisor,
  passoPct,
  pctDe,
  pctDoGuardar,
  reescalarAporteEscolhido,
  reescalarGrupos,
  repartirEmReaisInteiros,
  simularRitmos,
  valorDePct,
  valorDePctNoTeto,
} from "./divisor";
import { gerarPlano } from "./motor";
import type { Grupo } from "./organizacao";
import type { Perfil } from "./types";

/*
  O divisor em porcentagem. Os números conferidos aqui saem do motor de verdade:
  - perfil A (renda 2.800, contas 1.600, rotativo 1.500, guardado 1.000):
    equilibrado 840 com teto 920 → acelerado 77%, piso livre R$ 280 (23%);
  - perfil do print (renda 1.500, contas 177): piso livre R$ 150 = 11%.
*/

const PERFIL_A: Perfil = {
  rendaMensal: 2800,
  tipoRenda: "clt",
  idade: 24,
  moradia: "dividido",
  custoMoradia: 700,
  gastosFixos: [
    { categoria: "mercado", valor: 450 },
    { categoria: "transporte_publico", valor: 200 },
    { categoria: "celular", valor: 90 },
    { categoria: "academia", valor: 120 },
    { categoria: "streaming", valor: 40 },
  ],
  dividas: [{ tipo: "rotativo", saldo: 1500 }],
  guardado: 1000,
  meta: { tipo: "viagem", valorAlvo: 6000 },
};

/** o print do dono: o "Guardar" editado pra sobra inteira deixava R$ 0 livre */
const PERFIL_PRINT: Perfil = {
  rendaMensal: 1500,
  tipoRenda: "clt",
  idade: 24,
  moradia: "pais",
  custoMoradia: 0,
  gastosFixos: [
    { categoria: "celular", valor: 77 },
    { categoria: "academia", valor: 100 },
  ],
  dividas: [],
  guardado: 500,
  aporteEscolhido: 1323,
};

const semEscolha = (p: Perfil): Perfil => {
  const copia = { ...p };
  delete copia.aporteEscolhido;
  return copia;
};

const pote = (id: string, valor: number, itens: Grupo["itens"] = []): Grupo => ({
  id,
  nome: id,
  icone: "Tag",
  valor,
  contaParaMeta: false,
  itens,
});

const guardar = (valor: number): Grupo => ({ ...pote("guardar", valor), nome: "Guardar", doSistema: true });

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("pctDe / valorDePct", () => {
  it("converte nos dois sentidos, arredondando", () => {
    expect(pctDe(840, 1200)).toBe(70);
    expect(pctDe(920, 1200)).toBe(77);
    expect(pctDe(150, 1323)).toBe(11);
    expect(valorDePct(70, 1200)).toBe(840);
    expect(valorDePct(50, 1323)).toBe(661.5);
  });

  it("base zero ou negativa dá 0, sem NaN", () => {
    expect(pctDe(100, 0)).toBe(0);
    expect(pctDe(100, -50)).toBe(0);
    expect(valorDePct(50, 0)).toBe(0);
    expect(pctDe(Number.NaN, 100)).toBe(0);
  });
});

describe("pctDoGuardar", () => {
  it("menos de R$ 1 de fora é resíduo de centavos: 100%, não 98%", () => {
    expect(pctDe(50, 50.9)).toBe(98);
    expect(pctDoGuardar(50, 50.9)).toBe(100);
    expect(pctDoGuardar(1000, 1000.55)).toBe(100);
    expect(pctDoGuardar(1000, 1000)).toBe(100);
  });

  it("R$ 1 ou mais de fora: a % de sempre", () => {
    expect(pctDoGuardar(49, 50.9)).toBe(pctDe(49, 50.9));
    expect(pctDoGuardar(840, 1200)).toBe(70);
    expect(pctDoGuardar(999, 1000)).toBe(100);
  });

  it("Guardar em zero, base zero ou valor que passa da base: a % de sempre", () => {
    expect(pctDoGuardar(0, 0.5)).toBe(0);
    expect(pctDoGuardar(100, 0)).toBe(0);
    expect(pctDoGuardar(1200, 1000)).toBe(pctDe(1200, 1000));
    expect(pctDoGuardar(Number.NaN, 100)).toBe(0);
  });
});

describe("valorDePctNoTeto", () => {
  it("na % do teto grava o teto exato, não o arredondado", () => {
    // 77% de 1.200 = 924, mas o teto é 920: gravar 924 invadiria o piso
    expect(valorDePctNoTeto(77, 1200, 920)).toBe(920);
    expect(valorDePctNoTeto(90, 1200, 920)).toBe(920);
  });

  it("abaixo do teto grava a % da base", () => {
    expect(valorDePctNoTeto(75, 1200, 920)).toBe(900);
    expect(valorDePctNoTeto(0, 1200, 920)).toBe(0);
  });
});

describe("passoPct", () => {
  it("anda de 5 em 5 pelos múltiplos e encosta no teto exato", () => {
    expect(passoPct(70, 1, 77)).toBe(75);
    expect(passoPct(75, 1, 77)).toBe(77);
    expect(passoPct(77, 1, 77)).toBe(77);
    expect(passoPct(72, 1, 77)).toBe(75);
  });

  it("descendo volta pro múltiplo de baixo e para no zero", () => {
    expect(passoPct(77, -1, 77)).toBe(75);
    expect(passoPct(75, -1, 77)).toBe(70);
    expect(passoPct(3, -1, 77)).toBe(0);
    expect(passoPct(0, -1, 77)).toBe(0);
  });
});

describe("simularRitmos", () => {
  it("perfil A: 50% · 70% · 77% (o acelerado é segurado pelo piso)", () => {
    const sims = simularRitmos(PERFIL_A);
    expect(sims.map((s) => s.ritmo)).toEqual(["leve", "equilibrado", "acelerado"]);
    expect(sims.map((s) => s.plano.aporte)).toEqual([600, 840, 920]);
    expect(sims.map((s) => s.pct)).toEqual([50, 70, 77]);
    expect(sims[2].plano.piso.mordeu).toBe(true);
  });

  it("perfil do print: 35% · 50% · 70%", () => {
    expect(simularRitmos(PERFIL_PRINT).map((s) => s.pct)).toEqual([35, 50, 70]);
  });

  it("com aporteEscolhido no perfil, os três ritmos continuam diferentes", () => {
    const sims = simularRitmos({ ...PERFIL_A, aporteEscolhido: 1000 });
    expect(sims.map((s) => s.plano.aporte)).toEqual([600, 840, 920]);
    for (const s of sims) expect("aporteEscolhido" in s.plano.perfil).toBe(false);
  });

  it("ignora também o aporteEscolhido das opções", () => {
    const sims = simularRitmos(PERFIL_A, { aporteEscolhido: 1000 });
    expect(sims.map((s) => s.plano.aporte)).toEqual([600, 840, 920]);
  });

  it("modo corte: % zero em todos", () => {
    const corte: Perfil = { ...PERFIL_A, custoMoradia: 3000 };
    expect(simularRitmos(corte).map((s) => s.pct)).toEqual([0, 0, 0]);
  });
});

/*
  Sem mínimo "Pra você": o único limite é a sobra inteira. Quem quer chegar
  mais rápido pode pôr 100% nos potes (pedido do dono depois de ver o 25%
  "chumbado" — o piso protege só a SUGESTÃO dos ritmos).
*/
describe("limitesDoDivisor", () => {
  it("perfil do print: o Guardar vai até 100% (R$ 1.323), sem mínimo pra você", () => {
    const plano = gerarPlano(semEscolha(PERFIL_PRINT));
    const l = limitesDoDivisor(plano, [guardar(plano.aporte)]);
    expect(l.base).toBe(1323);
    expect(l.maxDe("guardar")).toBe(1323);
    expect(pctDe(l.maxDe("guardar"), l.base)).toBe(100);
    expect(l.livre).toBe(1323 - plano.aporte);
    expect(l.maxDe("pote-novo")).toBe(l.livre);
    expect(l.passou).toBe(false);
  });

  it("perfil A: cada pote cresce até o que está no Pra você", () => {
    const plano = gerarPlano(PERFIL_A);
    const l = limitesDoDivisor(plano, [guardar(840), pote("namoro", 50)]);
    expect(l.livre).toBe(310);
    expect(l.maxDe("guardar")).toBe(1150);
    expect(l.maxDe("namoro")).toBe(360);
  });

  it("potes somando exatamente 100%: nada passou, Pra você em R$ 0, nenhum pote cresce", () => {
    const plano = gerarPlano(semEscolha(PERFIL_PRINT));
    const l = limitesDoDivisor(plano, [guardar(1323)]);
    expect(l.passou).toBe(false);
    expect(l.excesso).toBe(0);
    expect(l.livre).toBe(0);
    expect(l.maxDe("guardar")).toBe(1323);
  });

  it("dado antigo que passa da sobra inteira: excesso em reais", () => {
    const plano = gerarPlano(semEscolha(PERFIL_PRINT));
    const l = limitesDoDivisor(plano, [guardar(1323), pote("namoro", 120)]);
    expect(l.passou).toBe(true);
    expect(l.excesso).toBe(120);
    expect(l.livre).toBe(0);
  });

  it("modo corte: nada a dividir, nenhum pote cresce", () => {
    const plano = gerarPlano({ ...PERFIL_A, custoMoradia: 3000 });
    const l = limitesDoDivisor(plano, [pote("namoro", 100)]);
    expect(l.base).toBe(0);
    expect(l.livre).toBe(0);
    expect(l.maxDe("namoro")).toBe(100);
  });
});

describe("reescalarGrupos", () => {
  const grupos = [
    pote("namoro", 300, [{ id: "i1", nome: "jantar", valor: 120 }]),
    pote("casa", 200.5),
    pote("estudos", 99.99, [
      { id: "i2", nome: "curso", valor: 50 },
      { id: "i3", nome: "livro", valor: 49.99 },
    ]),
  ];

  it("mantém a % de cada pote quando a sobra cai (fator < 1)", () => {
    const novos = reescalarGrupos(grupos, 1323, 1200);
    const fator = 1200 / 1323;
    novos.forEach((g, i) => expect(Math.abs(g.valor - grupos[i].valor * fator)).toBeLessThan(0.01));
    expect(soma(novos.map((g) => g.valor))).toBeCloseTo(Math.round(soma(grupos.map((g) => g.valor)) * fator * 100) / 100, 2);
  });

  it("e quando sobe (fator > 1)", () => {
    const novos = reescalarGrupos(grupos, 1000, 1500);
    expect(novos.map((g) => g.valor)).toEqual([450, 300.75, 149.99]);
  });

  it("os itens escalam junto e nunca passam do pote", () => {
    for (const [de, para] of [
      [1323, 1200],
      [1000, 1777],
      [1200, 13],
    ]) {
      const novos = reescalarGrupos(grupos, de, para);
      for (const g of novos) {
        expect(soma(g.itens.map((i) => i.valor))).toBeLessThanOrEqual(g.valor + 1e-9);
      }
    }
  });

  it("ida e volta 1.323 → 1.200 → 1.323 volta no centavo", () => {
    const ida = reescalarGrupos(grupos, 1323, 1200);
    const volta = reescalarGrupos(ida, 1200, 1323);
    volta.forEach((g, i) => {
      expect(Math.abs(g.valor - grupos[i].valor)).toBeLessThanOrEqual(0.01 + 1e-9);
      g.itens.forEach((item, j) => expect(Math.abs(item.valor - grupos[i].itens[j].valor)).toBeLessThanOrEqual(0.01 + 1e-9));
    });
  });

  it("sem base de referência, base ≤ 0 ou base igual: devolve os mesmos grupos", () => {
    expect(reescalarGrupos(grupos, undefined, 1200)).toBe(grupos);
    expect(reescalarGrupos(grupos, 1323, 0)).toBe(grupos);
    expect(reescalarGrupos(grupos, 1323, -200)).toBe(grupos);
    expect(reescalarGrupos(grupos, 1323, 1323.004)).toBe(grupos);
    expect(reescalarGrupos(grupos, 0, 1200)).toBe(grupos);
  });

  it("não mexe nos grupos de entrada", () => {
    const copia = structuredClone(grupos);
    reescalarGrupos(grupos, 1323, 1200);
    expect(grupos).toEqual(copia);
  });
});

describe("reescalarAporteEscolhido", () => {
  // perfil A sem dívida: sobra 1.200
  const anterior: Perfil = { ...PERFIL_A, dividas: [], aporteEscolhido: 720 };

  it("60% de R$ 1.200 vira 60% de R$ 1.500 quando a sobra sobe", () => {
    const novo = reescalarAporteEscolhido(anterior, { ...anterior, rendaMensal: 3100 });
    expect(novo.aporteEscolhido).toBe(900);
  });

  it("e 60% de R$ 900 quando a sobra desce", () => {
    const novo = reescalarAporteEscolhido(anterior, { ...anterior, rendaMensal: 2500 });
    expect(novo.aporteEscolhido).toBe(540);
  });

  it("sobra nova ≤ 0: a chave some", () => {
    const novo = reescalarAporteEscolhido(anterior, { ...anterior, rendaMensal: 1500 });
    expect("aporteEscolhido" in novo).toBe(false);
  });

  it("sem perfil anterior: fica o valor", () => {
    const perfilNovo = { ...anterior, rendaMensal: 3100 };
    expect(reescalarAporteEscolhido(null, perfilNovo)).toBe(perfilNovo);
  });

  it("sem escolha manual: devolve o perfil novo como está", () => {
    const perfilNovo = semEscolha({ ...anterior, rendaMensal: 3100 });
    expect(reescalarAporteEscolhido(anterior, perfilNovo)).toBe(perfilNovo);
  });

  it("sobra igual: não mexe", () => {
    const perfilNovo = { ...anterior, idade: 30 };
    expect(reescalarAporteEscolhido(anterior, perfilNovo).aporteEscolhido).toBe(720);
  });
});

describe("repartirEmReaisInteiros", () => {
  it("R$ 661,50 + R$ 661,50 vira R$ 662 + R$ 661 = R$ 1.323", () => {
    expect(repartirEmReaisInteiros([661.5, 661.5], 1323)).toEqual([662, 661]);
  });

  it("valores inteiros ficam como estão", () => {
    expect(repartirEmReaisInteiros([840, 360], 1200)).toEqual([840, 360]);
  });

  it("três terços fecham a soma", () => {
    const partes = repartirEmReaisInteiros([100 / 3, 100 / 3, 100 / 3], 100);
    expect(soma(partes)).toBe(100);
    expect(partes).toEqual([34, 33, 33]);
  });

  it("valores que não somam o total são repartidos na proporção", () => {
    expect(repartirEmReaisInteiros([1, 1], 3)).toEqual([2, 1]);
  });

  it("zeros e total ≤ 0 dão zeros", () => {
    expect(repartirEmReaisInteiros([0, 0], 100)).toEqual([0, 0]);
    expect(repartirEmReaisInteiros([10, 20], 0)).toEqual([0, 0]);
    expect(repartirEmReaisInteiros([], 100)).toEqual([]);
  });

  it("perfil do print: o que se guarda e o que fica livre fecham a sobra", () => {
    const plano = gerarPlano(semEscolha(PERFIL_PRINT));
    const [aporte, livre] = repartirEmReaisInteiros([plano.aporte, plano.livre], plano.resumo.excedente);
    expect(aporte + livre).toBe(1323);
  });
});
