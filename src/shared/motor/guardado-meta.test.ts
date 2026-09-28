/*
  GERADO a partir de dindinFrontend/src/domain/guardado-meta.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { simularRitmos } from "./divisor";
import {
  comTotalGuardado,
  guardadoNaMetaEfetivo,
  metaComGuardadoEfetivo,
  opcoesGuardadoNaMeta,
  saldosIniciaisDaMeta,
  totalGuardadoNaMeta,
} from "./guardado-meta";
import { caminhoDoPlano } from "./marcos";
import { gerarPlano } from "./motor";
import { projetarMeta } from "./organizacao";
import { respostaDoPlano, type RespostaPlano } from "./resposta";
import type { GuardadoNaMeta, Meta, Perfil } from "./types";
import { formatBRL } from "./format";

/*
  O que a pessoa JÁ tem guardado e decidiu pôr na meta: sai da reserva (o
  mesmo real não conta duas vezes) e entra na meta desde o mês 0, rendendo.
*/

const HOJE = new Date(2026, 8, 24);

/** PJ, sobra R$ 600, reserva de 6 × 1.400 = R$ 8.400, R$ 20.000 guardados → degrau 4 */
const BASE: Perfil = {
  rendaMensal: 2000,
  tipoRenda: "pj",
  idade: 25,
  moradia: "pais",
  custoMoradia: 0,
  gastosFixos: [{ categoria: "mercado", valor: 1400 }],
  dividas: [],
  guardado: 20000,
  meta: { tipo: "casa", valorAlvo: 33000 },
};

const pote = (valor: number, rendimentoMensal?: number, id = "p1"): GuardadoNaMeta => ({
  id,
  nome: "Já guardado",
  valor,
  ...(rendimentoMensal !== undefined ? { rendimentoMensal } : {}),
});

const comGuardados = (guardados: GuardadoNaMeta[], extra: Partial<Perfil> = {}): Perfil => ({
  ...BASE,
  ...extra,
  meta: { ...(BASE.meta as Meta), guardados },
});

function resposta(perfil: Perfil): RespostaPlano {
  const plano = gerarPlano(perfil);
  const caminho = caminhoDoPlano(plano, { hoje: HOJE });
  const r = respostaDoPlano(plano, {
    projecaoMeta: plano.degrau === 4 ? (caminho.meta?.projecao ?? null) : null,
    simulacoes: simularRitmos(perfil),
    hoje: HOJE,
  });
  if (r.modo !== "plano") throw new Error("esperava plano");
  return r;
}

describe("somas e limites", () => {
  it("total e efetivo: a soma dos potes, nunca mais que o guardado", () => {
    const meta: Meta = { tipo: "casa", valorAlvo: 1000, guardados: [pote(300), pote(200, undefined, "p2")] };
    expect(totalGuardadoNaMeta(meta)).toBe(500);
    expect(guardadoNaMetaEfetivo({ guardado: 1000, meta })).toBe(500);
    expect(guardadoNaMetaEfetivo({ guardado: 400, meta })).toBe(400);
    expect(totalGuardadoNaMeta(undefined)).toBe(0);
    expect(totalGuardadoNaMeta({ tipo: "casa", valorAlvo: 1 })).toBe(0);
  });

  it("comTotalGuardado: sem potes cria um; com potes reparte na proporção, no centavo", () => {
    expect(comTotalGuardado(undefined, 0, () => "x")).toEqual([]);
    expect(comTotalGuardado([], 1500, () => "novo")).toEqual([{ id: "novo", nome: "Já guardado", valor: 1500 }]);
    const dois = comTotalGuardado([pote(300, 0.01), pote(100, undefined, "p2")], 1000, () => "x");
    expect(dois.map((g) => g.valor)).toEqual([750, 250]);
    expect(dois[0].rendimentoMensal).toBe(0.01);
    const terco = comTotalGuardado([pote(1), pote(1, undefined, "b"), pote(1, undefined, "c")], 100, () => "x");
    expect(terco.reduce((a, g) => a + g.valor, 0)).toBeCloseTo(100, 2);
    expect(comTotalGuardado([pote(0), pote(0, undefined, "b")], 50, () => "x").map((g) => g.valor)).toEqual([50, 0]);
  });

  it("metaComGuardadoEfetivo: acima do guardado, encolhe na proporção; dentro, é a mesma meta", () => {
    const meta: Meta = { tipo: "casa", valorAlvo: 1000, guardados: [pote(600), pote(200, undefined, "p2")] };
    expect(metaComGuardadoEfetivo(meta, 5000)).toBe(meta);
    const limitada = metaComGuardadoEfetivo(meta, 400);
    expect(limitada.guardados?.map((g) => g.valor)).toEqual([300, 100]);
    expect(limitada.guardados?.map((g) => g.id)).toEqual(["p1", "p2"]);
  });

  it("saldos iniciais: só potes com dinheiro, taxa limitada a 5%", () => {
    const meta: Meta = { tipo: "casa", valorAlvo: 1, guardados: [pote(100, 0.2), pote(0, 0.01, "b"), pote(50, undefined, "c")] };
    expect(saldosIniciaisDaMeta(meta)).toEqual([
      { valor: 100, taxa: 0.05 },
      { valor: 50, taxa: 0 },
    ]);
  });

  it("opções da pergunta: guardado, reserva e o que passa dela", () => {
    const plano = gerarPlano(BASE);
    expect(opcoesGuardadoNaMeta(plano)).toEqual({ guardado: 20000, reserva: 8400, excedente: 11600 });
    expect(opcoesGuardadoNaMeta(gerarPlano({ ...BASE, guardado: 5000 })).excedente).toBe(0);
  });
});

describe("motor: o que foi pra meta não é reserva", () => {
  it("sem nada na meta, é o plano de sempre", () => {
    const plano = gerarPlano(BASE);
    expect(plano.guardadoNaMeta).toBe(0);
    expect(plano.reserva.ok).toBe(true);
    expect(plano.degrau).toBe(4);
  });

  it("só o que passa da reserva: a reserva continua cheia", () => {
    const plano = gerarPlano(comGuardados([pote(11600)]));
    expect(plano.guardadoNaMeta).toBe(11600);
    expect(plano.reserva.ok).toBe(true);
    expect(plano.degrau).toBe(4);
  });

  it("tudo na meta: a reserva volta a faltar e o plano completa ela antes (escolha dela, não trava)", () => {
    const plano = gerarPlano(comGuardados([pote(20000)]));
    expect(plano.guardadoNaMeta).toBe(20000);
    expect(plano.reserva.ok).toBe(false);
    expect(plano.reserva.falta).toBe(8400);
    expect(plano.degrau).toBe(0);
  });

  it("potes acima do guardado (guardado baixou depois): vale só o guardado", () => {
    const plano = gerarPlano(comGuardados([pote(20000)], { guardado: 3000 }));
    expect(plano.guardadoNaMeta).toBe(3000);
    expect(plano.folego.atual).toBe(0);
  });
});

describe("projeção: a meta começa do que já está guardado, rendendo", () => {
  it("R$ 11.600 na meta encurta o prazo; rendendo 0,8% encurta mais", () => {
    const zero = projetarMeta(BASE.meta as Meta, [], 420, HOJE);
    const comSaldo = projetarMeta({ ...(BASE.meta as Meta), guardados: [pote(11600)] }, [], 420, HOJE);
    const rendendo = projetarMeta({ ...(BASE.meta as Meta), guardados: [pote(11600, 0.008)] }, [], 420, HOJE);
    expect(zero.meses).toBe(79);
    expect(comSaldo.meses).toBe(51);
    expect(comSaldo.jaGuardado).toBe(11600);
    expect(rendendo.meses!).toBeLessThan(comSaldo.meses!);
    expect(rendendo.semRendimento).toBe(comSaldo.meses);
  });

  it("saldo rendendo sozinho (sem aporte) ainda chega; parado e sem taxa, não", () => {
    const meta: Meta = { tipo: "casa", valorAlvo: 12000, guardados: [pote(10000, 0.01)] };
    expect(projetarMeta(meta, [], 0, HOJE).meses).toBe(19);
    expect(projetarMeta({ ...meta, guardados: [pote(10000)] }, [], 0, HOJE).meses).toBeNull();
  });

  it("o caminho e o cartão usam o mesmo prazo, com o já guardado", () => {
    const perfil = comGuardados([pote(11600, 0.008)]);
    const plano = gerarPlano(perfil);
    const caminho = caminhoDoPlano(plano, { hoje: HOJE });
    const r = resposta(perfil);
    expect(r.tempo.tipo).toBe("prazo");
    if (r.tempo.tipo === "prazo") expect(r.tempo.meses).toBe(caminho.meta?.projecao.meses);
    expect(r.alvo).toMatchObject({ rotulo: "Meta", valor: 33000, detalhe: `já tem ${formatBRL(11600)}` });
    expect(r.rendimentoAdianta).toBeGreaterThan(0);
  });

  it("tudo na meta com a reserva faltando: o saldo rende desde já e o plano entra depois", () => {
    const plano = gerarPlano(comGuardados([pote(20000, 0.008)]));
    const caminho = caminhoDoPlano(plano, { hoje: HOJE });
    expect(caminho.meta?.projecao.jaGuardado).toBe(20000);
    expect(caminho.meta?.projecao.meses).not.toBeNull();
    expect(caminho.marcos.map((m) => m.id)).toContain("meta");
  });
});

describe("meta que o já guardado paga sozinho", () => {
  const perfil: Perfil = { ...BASE, meta: { tipo: "viagem", valorAlvo: 5000, guardados: [pote(6000)] } };

  it("o cartão diz 'Meta já garantida', sem prazo", () => {
    const r = resposta(perfil);
    expect(r.tempo).toMatchObject({ tipo: "pronta", texto: "Meta já garantida" });
    if (r.tempo.tipo === "pronta") expect(r.tempo.frase).toContain(formatBRL(6000));
  });

  it("o caminho mostra a meta como feita", () => {
    const plano = gerarPlano(perfil);
    const { marcos } = caminhoDoPlano(plano, { hoje: HOJE });
    // com a reserva já completa, o caminho mostra de onde ela vem e a meta já feita
    expect(marcos.map((m) => [m.id, m.estado])).toEqual([
      ["reserva", "feito"],
      ["meta", "feito"],
    ]);
    expect(marcos[1].rotulo).toBe("Viagem já garantida");
  });
});
