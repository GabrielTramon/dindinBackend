/*
  GERADO a partir de dindinFrontend/src/domain/marcos.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import {
  aportePrevistoNasMetas,
  marcosDoPlano,
  mesCurto,
  mesEstimado,
  projetarMetaNoCaminho,
} from "./marcos";
import { gerarPlano } from "./motor";
import { projetarMeta, type Grupo } from "./organizacao";
import type { Meta, Perfil } from "./types";
import { formatBRL } from "./format";

/*
  "Seu caminho". Os prazos vêm do motor (acumulados, o mês atual é o 1); o que
  estes testes protegem é que o caminho diz o MESMO que o resto do plano, e que
  a meta antes do degrau 4 tem prazo (antes dizia "nenhum grupo entra nela").
*/

const HOJE = new Date(2026, 8, 24); // setembro de 2026

const VIAGEM: Meta = { tipo: "viagem", valorAlvo: 6000 };

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
  meta: VIAGEM,
};

/** o print do dono com nada guardado: degrau 0 */
const PRINT_ZERADO: Perfil = {
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
  guardado: 0,
};

const guardar = (valor: number, contaParaMeta = false): Grupo => ({
  id: "guardar",
  nome: "Guardar",
  icone: "PiggyBank",
  valor,
  contaParaMeta,
  doSistema: true,
  itens: [],
});

const pote = (id: string, valor: number, contaParaMeta: boolean, rendimentoMensal?: number): Grupo => ({
  id,
  nome: id,
  icone: "Tag",
  valor,
  contaParaMeta,
  ...(rendimentoMensal !== undefined ? { rendimentoMensal } : {}),
  itens: [],
});

describe("mesEstimado / mesCurto", () => {
  it("contam a partir do mês de hoje", () => {
    expect(mesEstimado(HOJE, 0)).toBe("setembro de 2026");
    expect(mesEstimado(HOJE, 3)).toBe("dezembro de 2026");
    expect(mesEstimado(HOJE, 4)).toBe("janeiro de 2027");
    expect(mesCurto(HOJE, 3)).toBe("dez 2026");
    expect(mesCurto(HOJE, 27)).toBe("dez 2028");
  });

  it("é a mesma convenção de projetarMeta", () => {
    const p = projetarMeta(VIAGEM, [pote("x", 1000, true)], 0, HOJE);
    expect(p.mesEstimado).toBe(mesEstimado(HOJE, p.meses ?? 0));
  });

  it("data inválida → null", () => {
    expect(mesEstimado(new Date(Number.NaN), 3)).toBeNull();
    expect(mesCurto(new Date(Number.NaN), 3)).toBeNull();
  });
});

describe("projetarMetaNoCaminho", () => {
  const casos: { nome: string; grupos: Grupo[]; aporte: number; meta: Meta }[] = [
    { nome: "só o plano", grupos: [], aporte: 360, meta: VIAGEM },
    {
      nome: "potes com e sem rendimento",
      grupos: [pote("a", 200, true, 0.008), pote("b", 150, false), pote("c", 99.99, true)],
      aporte: 300,
      meta: { tipo: "carro", valorAlvo: 10000 },
    },
    { nome: "só potes", grupos: [pote("a", 123.45, true, 0.01)], aporte: 0, meta: VIAGEM },
    { nome: "ninguém contribui", grupos: [pote("a", 100, false)], aporte: 0, meta: VIAGEM },
    { nome: "não fecha em 50 anos", grupos: [], aporte: 1, meta: { tipo: "casa", valorAlvo: 1_000_000 } },
  ];

  for (const c of casos) {
    it(`no degrau 4 (início 0) é exatamente projetarMeta — ${c.nome}`, () => {
      expect(projetarMetaNoCaminho(c.meta, c.grupos, c.aporte, 0, HOJE)).toEqual(
        projetarMeta(c.meta, c.grupos, c.aporte, HOJE),
      );
    });
  }

  it("o plano só entra depois do início; os potes desde o mês 1", () => {
    const meta: Meta = { tipo: "outro", nome: "Bike", valorAlvo: 1200 };
    // mês 1..2: só o pote (100, 200); do mês 3 em diante, +100 do plano por mês
    const p = projetarMetaNoCaminho(meta, [pote("a", 100, true)], 100, 2, HOJE);
    expect(p.meses).toBe(7);
    expect(p.mesEstimado).toBe(mesEstimado(HOJE, 7));
    expect(p.aporteMensal).toBe(200);
  });

  it("início null: o plano nunca chega, só os potes contam", () => {
    const meta: Meta = { tipo: "outro", nome: "Bike", valorAlvo: 1200 };
    expect(projetarMetaNoCaminho(meta, [pote("a", 100, true)], 100, null, HOJE).meses).toBe(12);
    expect(projetarMetaNoCaminho(meta, [], 100, null, HOJE).meses).toBeNull();
  });
});

describe("aportePrevistoNasMetas", () => {
  it("antes do degrau 4, é o aporte de um plano já sem as dívidas e com a reserva cheia", () => {
    const plano = gerarPlano(PERFIL_A);
    // sobra 1.200 × 30% (equilibrado, degrau 4)
    expect(aportePrevistoNasMetas(plano)).toBe(360);
  });

  it("no degrau 4, é o aporte do mês", () => {
    const plano = gerarPlano({ ...PERFIL_A, dividas: [], guardado: 10000 });
    expect(plano.degrau).toBe(4);
    expect(aportePrevistoNasMetas(plano)).toBe(plano.aporte);
  });

  it("no degrau 4, 0 quando o Guardar já conta na meta (senão contaria duas vezes)", () => {
    const plano = gerarPlano({ ...PERFIL_A, dividas: [], guardado: 10000 });
    expect(plano.degrau).toBe(4);
    expect(aportePrevistoNasMetas(plano, [guardar(plano.aporte, true)])).toBe(0);
  });

  it("antes do degrau 4, o 'entra na meta' do Guardar não vale: o dinheiro dele ainda paga o cartão", () => {
    const plano = gerarPlano(PERFIL_A);
    expect(aportePrevistoNasMetas(plano, [guardar(840, true)])).toBe(aportePrevistoNasMetas(plano));
  });
});

describe("marcosDoPlano", () => {
  it("perfil A no equilibrado: cartão em 3 meses, reserva em 10, viagem em 27", () => {
    const plano = gerarPlano(PERFIL_A);
    const marcos = marcosDoPlano(plano, { grupos: [guardar(840)], hoje: HOJE });
    expect(marcos.map((m) => [m.id, m.rotulo, m.meses, m.mes, m.estado])).toEqual([
      ["caras", "Cartão quitado", 3, "dez 2026", "atual"],
      ["reserva", `Reserva de ${formatBRL(4800)}`, 10, "jul 2027", "depois"],
      ["meta", "Viagem", 27, "dez 2028", "depois"],
    ]);
    expect(marcos[0].mesExtenso).toBe("dezembro de 2026");
    expect(marcos.every((m) => !m.semPrazo)).toBe(true);
  });

  it("no acelerado os meses se mexem juntos", () => {
    const plano = gerarPlano({ ...PERFIL_A, ritmo: "acelerado" });
    const marcos = marcosDoPlano(plano, { hoje: HOJE });
    expect(marcos[0].meses).toBe(plano.dividas.mesesParaQuitarCaras);
    expect(marcos[1].meses).toBe(plano.reserva.mesesParaCompletar);
  });

  it("degrau 0: fôlego e reserva no mesmo mês se fundem", () => {
    const plano = gerarPlano(PRINT_ZERADO);
    expect(plano.degrau).toBe(0);
    const marcos = marcosDoPlano(plano, { hoje: HOJE });
    expect(marcos).toHaveLength(1);
    expect(marcos[0]).toMatchObject({
      id: "folego+reserva",
      rotulo: "Fôlego e reserva prontos",
      meses: 1,
      mes: "out 2026",
      estado: "atual",
    });
  });

  it("degrau 0 com meta: a meta começa a receber depois da reserva", () => {
    const plano = gerarPlano({ ...PRINT_ZERADO, meta: VIAGEM });
    const marcos = marcosDoPlano(plano, { hoje: HOJE });
    expect(marcos.map((m) => m.id)).toEqual(["folego+reserva", "meta"]);
    const noMes = aportePrevistoNasMetas(plano);
    expect(noMes).toBeGreaterThan(0);
    expect(marcos[1].meses).toBe(1 + Math.ceil(6000 / noMes));
  });

  it("dívida cara sem prazo: 'sem prazo' nela, e os seguintes ficam 'depois'", () => {
    const perfil: Perfil = {
      rendaMensal: 2000,
      tipoRenda: "clt",
      idade: 24,
      moradia: "aluguel",
      custoMoradia: 1700,
      gastosFixos: [],
      dividas: [{ tipo: "rotativo", saldo: 5000 }],
      guardado: 1000,
      meta: VIAGEM,
    };
    const plano = gerarPlano(perfil);
    expect(plano.dividas.mesesParaQuitarCaras).toBeNull();
    const marcos = marcosDoPlano(plano, { hoje: HOJE });
    expect(marcos.map((m) => [m.id, m.meses, m.mes, m.semPrazo, m.estado])).toEqual([
      ["caras", null, null, true, "atual"],
      ["reserva", null, null, false, "depois"],
      ["meta", null, null, false, "depois"],
    ]);
  });

  it("reserva já ok: não vira marco, e a meta começa quando o cartão zera", () => {
    const plano = gerarPlano({ ...PERFIL_A, guardado: 10000 });
    expect(plano.reserva.ok).toBe(true);
    const marcos = marcosDoPlano(plano, { hoje: HOJE });
    expect(marcos.map((m) => m.id)).toEqual(["caras", "meta"]);
    const caras = plano.dividas.mesesParaQuitarCaras ?? 0;
    expect(marcos[1].meses).toBe(caras + Math.ceil(6000 / aportePrevistoNasMetas(plano)));
  });

  it("sem dívidas: reserva em 7 meses (abril de 2027), viagem 17 meses depois", () => {
    const plano = gerarPlano({ ...PERFIL_A, dividas: [] });
    expect(plano.degrau).toBe(2);
    const marcos = marcosDoPlano(plano, { hoje: HOJE });
    expect(marcos.map((m) => [m.id, m.meses, m.mesExtenso])).toEqual([
      ["reserva", 7, "abril de 2027"],
      ["meta", 24, "setembro de 2028"],
    ]);
  });

  it("meta sem pote no degrau 4: o prazo é o de projetarMeta com o aporte, e o passo resolvido aparece como feito", () => {
    const plano = gerarPlano({ ...PERFIL_A, dividas: [], guardado: 10000 });
    const marcos = marcosDoPlano(plano, { grupos: [], hoje: HOJE });
    const esperado = projetarMeta(VIAGEM, [], plano.aporte, HOJE).meses;
    expect(marcos.map((m) => [m.id, m.estado])).toEqual([
      ["reserva", "feito"],
      ["meta", "atual"],
    ]);
    expect(marcos[0].rotulo).toBe("Reserva completa");
    expect(marcos[1].meses).toBe(esperado);
    expect(esperado).toBe(17);
  });

  it("no degrau 4 com o Guardar contando na meta, o aporte não conta duas vezes", () => {
    const plano = gerarPlano({ ...PERFIL_A, dividas: [], guardado: 10000 });
    const grupos = [guardar(plano.aporte, true)];
    const marcos = marcosDoPlano(plano, { grupos, hoje: HOJE });
    expect(marcos.at(-1)?.meses).toBe(projetarMeta(VIAGEM, grupos, 0, HOJE).meses);
  });

  it("modo corte: nenhum marco", () => {
    const plano = gerarPlano({ ...PERFIL_A, custoMoradia: 3000 });
    expect(marcosDoPlano(plano, { hoje: HOJE })).toEqual([]);
  });

  it("a meta das opções vale sobre a do perfil", () => {
    const plano = gerarPlano(PERFIL_A);
    const marcos = marcosDoPlano(plano, { meta: { tipo: "outro", nome: "Japão", valorAlvo: 3600 }, hoje: HOJE });
    expect(marcos.at(-1)).toMatchObject({ id: "meta", rotulo: "Japão", meses: 20 });
  });
});
