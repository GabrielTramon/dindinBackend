/*
  GERADO a partir de dindinFrontend/src/domain/cartao-meta.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { simularRitmos } from "./divisor";
import { cartaoDaMeta } from "./cartao-meta";
import { caminhoDoPlano } from "./marcos";
import { gerarPlano } from "./motor";
import type { Grupo } from "./organizacao";
import { respostaDoPlano } from "./resposta";
import type { Meta, Perfil } from "./types";
import { formatBRL } from "./format";

/*
  O cartão "Sua meta" com o perfil do print do dono (28/09/2026): R$ 30.000
  já guardados pra Liberdade financeira (R$ 50.000) rendendo 1,5%, o Guardar
  em R$ 2.544 rendendo 1%. O topo mostrava "Montar seu fôlego · por 1 mês" e
  ele leu "1 mês pra R$ 50.000": o prazo da meta (8 meses) só estava no caminho.
*/

const HOJE = new Date(2026, 8, 28);

const META: Meta = {
  tipo: "liberdade",
  valorAlvo: 50000,
  guardados: [{ id: "a", nome: "Já guardado", valor: 30000, rendimentoMensal: 0.015 }],
};

const PRINT: Perfil = {
  rendaMensal: 3169,
  tipoRenda: "clt",
  idade: 25,
  moradia: "pais",
  custoMoradia: 0,
  gastosFixos: [{ categoria: "mercado", valor: 177 }],
  dividas: [],
  guardado: 30000,
  aporteEscolhido: 2544,
  meta: META,
};

const guardar = (valor: number, rendimentoMensal?: number): Grupo => ({
  id: "guardar",
  nome: "Guardar",
  icone: "PiggyBank",
  valor,
  contaParaMeta: false,
  doSistema: true,
  itens: [],
  ...(rendimentoMensal !== undefined ? { rendimentoMensal } : {}),
});

function cartao(perfil: Perfil, grupos: Grupo[] = []) {
  const plano = gerarPlano(perfil);
  const caminho = caminhoDoPlano(plano, { grupos, hoje: HOJE });
  if (!caminho.meta || !perfil.meta) throw new Error("sem meta");
  return { plano, caminho, cartao: cartaoDaMeta(perfil.meta, caminho.meta, HOJE) };
}

describe("cartão 'Sua meta' — o print do dono", () => {
  it("o passo de agora é o fôlego (1 mês), mas a meta chega em 8 meses, e o cartão diz isso", () => {
    const { plano, caminho, cartao: c } = cartao(PRINT, [guardar(2544, 0.01)]);
    expect(plano.degrau).toBe(0);
    expect(caminho.marcos.map((m) => [m.rotulo, m.meses])).toEqual([
      ["Fôlego e reserva prontos", 1],
      ["Liberdade financeira", 8],
    ]);
    expect(c).toMatchObject({
      nome: "Liberdade financeira",
      icone: "Bird",
      valorAlvo: 50000,
      jaTem: 30000,
      pct: 60,
      estado: "prazo",
      titulo: "Chega em 8 meses",
      mes: "maio de 2027",
    });
    expect(c.como).toBe(
      `Começa com ${formatBRL(30000)} já guardados, rendendo, e recebe ${formatBRL(2544)} por mês a partir de novembro de 2026.`,
    );
  });

  it("o topo avisa que o prazo dele é o do passo de agora", () => {
    const plano = gerarPlano(PRINT);
    const r = respostaDoPlano(plano, { simulacoes: simularRitmos(PRINT), hoje: HOJE });
    if (r.modo !== "plano") throw new Error("esperava plano");
    expect(r.depois).toBe("Esse é o passo de agora. Depois, o plano segue pra Liberdade financeira.");
  });

  it("no degrau 4 não há 'depois': o topo já é a meta", () => {
    const noDegrau4: Perfil = { ...PRINT, guardado: 40000, meta: { ...META, guardados: [{ ...META.guardados![0], valor: 30000 }] } };
    const plano = gerarPlano(noDegrau4);
    expect(plano.degrau).toBe(4);
    const r = respostaDoPlano(plano, { simulacoes: simularRitmos(noDegrau4), hoje: HOJE });
    expect(r.modo === "plano" && r.depois).toBeUndefined();
  });
});

describe("cartão 'Sua meta' — outros estados", () => {
  it("começando do zero", () => {
    const { cartao: c } = cartao({ ...PRINT, guardado: 0, meta: { tipo: "viagem", valorAlvo: 6000 } });
    expect(c.jaTem).toBe(0);
    expect(c.pct).toBe(0);
    expect(c.como.startsWith("Começa do zero e recebe")).toBe(true);
  });

  it("já garantida pelo que está guardado", () => {
    const { cartao: c } = cartao({ ...PRINT, meta: { ...META, valorAlvo: 20000 } });
    expect(c).toMatchObject({ estado: "garantida", titulo: "Já garantida", pct: 100, mes: null, jaTem: 20000 });
  });

  it("guardando 0% e sem saldo rendendo: não fecha", () => {
    const { cartao: c } = cartao({ ...PRINT, guardado: 0, aporteEscolhido: 0, meta: { tipo: "viagem", valorAlvo: 6000 } });
    expect(c.estado).toBe("sem-prazo");
    expect(c.titulo).toBe("Não fecha nesse ritmo");
  });

  it("o Guardar rende a taxa dele quando o dinheiro chega na meta (antes do degrau 4 também)", () => {
    // tudo guardado na meta: a reserva falta, o plano está no fôlego (degrau 0)
    const longe: Perfil = { ...PRINT, meta: { ...META, valorAlvo: 150000 } };
    expect(gerarPlano(longe).degrau).toBe(0);
    const semTaxa = cartao(longe, [guardar(2544)]).caminho.meta!;
    const comTaxa = cartao(longe, [guardar(2544, 0.02)]).caminho.meta!;
    expect(comTaxa.projecao.meses!).toBeLessThan(semTaxa.projecao.meses!);
  });
});
