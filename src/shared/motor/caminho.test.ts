/*
  GERADO a partir de dindinFrontend/src/domain/caminho.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { LIMIAR_DIVIDA_CARA, PROPORCAO_APORTE } from "./config";
import { avaliarDividas, gerarPlano, simularQuitacao } from "./motor";
import type { Perfil } from "./types";
/** Açúcar dos testes: um gasto fixo único, pra cenários que só olham o total. */
const gastos = (valor: number) => (valor > 0 ? [{ categoria: "mercado", valor }] : []);


/*
  As projeções seguem o caminho da cascata, não só o mês atual.
  "Nesse ritmo" quer dizer "seguindo o plano": se hoje o aporte vai pro
  fôlego, a dívida é projetada com o ritmo que ela recebe depois.
*/

const base: Perfil = {
  rendaMensal: 3000,
  tipoRenda: "clt",
  idade: 24,
  moradia: "aluguel",
  custoMoradia: 1000,
  gastosFixos: gastos(800),
  dividas: [],
  guardado: 0,
};

describe("projeção da dívida cara no degrau 0", () => {
  it("não alarma quando o fôlego absorve o aporte do mês: projeta com o ritmo do degrau 1", () => {
    // custoTotal 1800 → fôlego 1000, falta 1000; excedente 1200; aporte0 720 (< falta: mês 1 inteiro vai pro fôlego)
    const p = gerarPlano({ ...base, dividas: [{ tipo: "rotativo", saldo: 2000 }] });
    expect(p.degrau).toBe(0);
    expect(p.alocacoes).toEqual([expect.objectContaining({ destino: "folego", valor: 720 })]);
    // este mês a dívida não recebe nada — mesmo assim tem prazo, porque o ritmo muda depois
    expect(p.dividas.mesesParaQuitarCaras).not.toBeNull();
    expect(p.dividas.mesesParaQuitarCaras!).toBeGreaterThan(2);
    expect(p.proximosPassos.some((t) => t.includes("não é opcional"))).toBe(false);
    expect(p.proximosPassos.some((t) => t.includes("zeram em"))).toBe(true);
  });

  it("o prazo da dívida no degrau 0 é maior do que seria já no degrau 1", () => {
    const semFolego = gerarPlano({ ...base, dividas: [{ tipo: "rotativo", saldo: 2000 }] });
    const comFolego = gerarPlano({
      ...base,
      dividas: [{ tipo: "rotativo", saldo: 2000 }],
      guardado: 1000,
    });
    expect(comFolego.degrau).toBe(1);
    expect(semFolego.dividas.mesesParaQuitarCaras!).toBeGreaterThan(
      comFolego.dividas.mesesParaQuitarCaras!,
    );
  });

  it("continua null quando nem o ritmo de regime cobre os juros", () => {
    const p = gerarPlano({ ...base, dividas: [{ tipo: "rotativo", saldo: 40000 }] });
    expect(p.degrau).toBe(0);
    expect(p.dividas.mesesParaQuitarCaras).toBeNull();
    expect(p.proximosPassos.some((t) => t.includes("não é opcional"))).toBe(true);
  });
});

describe("projeção da reserva", () => {
  it("no degrau 0 sem dívida: fôlego primeiro, depois o ritmo do degrau 2", () => {
    // fôlego 1000 (falta 1000), aporte0 720 → 2 meses de fôlego (1440 aportados)
    // reserva alvo 5400, falta 5400 − 1440 = 3960 no ritmo do degrau 2 (600) → 7 meses
    const p = gerarPlano(base);
    expect(p.degrau).toBe(0);
    const aporte0 = p.resumo.excedente * PROPORCAO_APORTE[0];
    const mesesFolego = Math.ceil(p.folego.falta / aporte0);
    const faltaDepois = p.reserva.falta - mesesFolego * aporte0;
    const aporte2 = p.resumo.excedente * PROPORCAO_APORTE[2];
    expect(p.reserva.mesesParaCompletar).toBe(mesesFolego + Math.ceil(faltaDepois / aporte2));
    expect(p.reserva.mesesParaCompletar).toBe(9);
  });

  it("no degrau 2 continua sendo falta ÷ aporte, contando este mês", () => {
    const p = gerarPlano({ ...base, guardado: 1000 });
    expect(p.degrau).toBe(2);
    expect(p.reserva.mesesParaCompletar).toBe(Math.ceil(p.reserva.falta / p.aporte));
  });

  it("custos zero: fôlego e reserva coincidem e fecham no mesmo mês", () => {
    const p = gerarPlano({ ...base, moradia: "pais", custoMoradia: 0, gastosFixos: gastos(0) });
    expect(p.folego.alvo).toBe(300);
    expect(p.reserva.alvo).toBe(300);
    expect(p.reserva.mesesParaCompletar).toBe(1);
  });

  it("em modo corte não há projeção", () => {
    const p = gerarPlano({ ...base, gastosFixos: gastos(2500), dividas: [{ tipo: "rotativo", saldo: 500 }] });
    expect(p.modoCorte).toBe(true);
    expect(p.reserva.mesesParaCompletar).toBeNull();
    expect(p.dividas.mesesParaQuitarCaras).toBeNull();
  });
});

describe("projeção da dívida média", () => {
  it("espera a reserva fechar e só então recebe o ritmo do degrau 3", () => {
    const p = gerarPlano({
      ...base,
      guardado: 1000,
      dividas: [{ tipo: "financiamento", saldo: 6000, parcela: 300 }],
    });
    expect(p.degrau).toBe(2);
    expect(p.reserva.mesesParaCompletar).not.toBeNull();
    // durante a espera a parcela sozinha não zera; o prazo total passa do prazo da reserva
    expect(p.dividas.mesesParaQuitarMedias).not.toBeNull();
    expect(p.dividas.mesesParaQuitarMedias!).toBeGreaterThan(p.reserva.mesesParaCompletar!);
  });

  it("não desiste durante a espera só porque a parcela ainda não cobre os juros", () => {
    const [d] = avaliarDividas([{ tipo: "financiamento", saldo: 6000, taxaAnual: 0.3, parcela: 100 }]);
    // juros ~2,2%/mês (≈ R$ 132) > parcela 100: sozinha, a dívida cresce.
    const meses = simularQuitacao([d], { extra: (m) => (m > 6 ? 800 : 0), regimeAPartirDe: 7 });
    expect(meses).not.toBeNull();
    expect(meses!).toBeGreaterThan(6);
  });
});

describe("classificação e sobra de parcela", () => {
  it("dívida acima do limiar mas abaixo da taxa livre de risco é barata", () => {
    const [d] = avaliarDividas([{ tipo: "outra", saldo: 1000, taxaAnual: LIMIAR_DIVIDA_CARA + 0.02 }], LIMIAR_DIVIDA_CARA + 0.05);
    expect(d.classe).toBe("barata");
  });

  it("a sobra da parcela no mês em que a dívida zera reforça a próxima no mesmo mês", () => {
    // sem juros: A = 100 com parcela 300 (sobra 200 no mês 1), B = 200 sem parcela e sem extra
    const [a, b] = avaliarDividas([
      { tipo: "outra", saldo: 100, taxaAnual: 0, parcela: 300 },
      { tipo: "outra", saldo: 200, taxaAnual: 0 },
    ]);
    expect(simularQuitacao([a, b], 0)).toBe(1);
  });
});
