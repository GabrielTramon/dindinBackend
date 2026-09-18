/*
  GERADO a partir de dindinFrontend/src/domain/aporte-escolhido.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { gerarPlano } from "./motor";
import type { Perfil } from "./types";

/*
  O aporte escolhido é o que acontece quando a pessoa edita o grupo "Guardar":
  ela decide o valor do mês no lugar do que o ritmo sugere.

  O que estes testes protegem é a coerência — o número que a tela mostra e o
  prazo que ela promete precisam sair da MESMA conta. Um aporte escolhido que
  entrasse só no valor do mês, e não nas projeções, faria a tela dizer "guarde
  R$ 300" e "você zera a dívida em 11 meses" com aportes diferentes.
*/

const base: Perfil = {
  rendaMensal: 3000,
  tipoRenda: "clt",
  idade: 24,
  moradia: "aluguel",
  custoMoradia: 900,
  gastosFixos: [{ categoria: "mercado", valor: 600 }],
  dividas: [],
  // fôlego fechado (alvo 1000) e reserva ainda faltando: é o estado em que as
  // projeções dizem alguma coisa
  guardado: 1000,
};

/** excedente = 3000 − 900 − 600 = 1500 */
const EXCEDENTE = 1500;

describe("aporteEscolhido", () => {
  it("substitui o valor do ritmo e o que fica livre acompanha", () => {
    const plano = gerarPlano(base, { aporteEscolhido: 400 });
    expect(plano.aporte).toBe(400);
    expect(plano.livre).toBe(EXCEDENTE - 400);
  });

  it("sem escolher, o plano é exatamente o do ritmo", () => {
    const comRitmo = gerarPlano(base);
    const escolhendoOMesmo = gerarPlano(base, { aporteEscolhido: comRitmo.aporte });
    expect(escolhendoOMesmo.aporte).toBe(comRitmo.aporte);
    expect(escolhendoOMesmo.reserva.mesesParaCompletar).toBe(comRitmo.reserva.mesesParaCompletar);
  });

  it("as projeções usam o valor escolhido — guardar menos demora mais", () => {
    const menos = gerarPlano(base, { aporteEscolhido: 150 });
    const mais = gerarPlano(base, { aporteEscolhido: 900 });

    expect(menos.reserva.mesesParaCompletar).not.toBeNull();
    expect(mais.reserva.mesesParaCompletar).not.toBeNull();
    expect(menos.reserva.mesesParaCompletar!).toBeGreaterThan(mais.reserva.mesesParaCompletar!);
  });

  it("vale também pro prazo da dívida cara", () => {
    const comDivida: Perfil = { ...base, dividas: [{ tipo: "rotativo", saldo: 2000, parcela: 100 }] };
    const menos = gerarPlano(comDivida, { aporteEscolhido: 200 });
    const mais = gerarPlano(comDivida, { aporteEscolhido: 1000 });

    expect(menos.dividas.mesesParaQuitarCaras).not.toBeNull();
    expect(mais.dividas.mesesParaQuitarCaras).not.toBeNull();
    expect(menos.dividas.mesesParaQuitarCaras!).toBeGreaterThan(mais.dividas.mesesParaQuitarCaras!);
  });

  it("não passa do excedente nem fica negativo", () => {
    expect(gerarPlano(base, { aporteEscolhido: 99_999 }).aporte).toBe(EXCEDENTE);
    expect(gerarPlano(base, { aporteEscolhido: 99_999 }).livre).toBe(0);
    expect(gerarPlano(base, { aporteEscolhido: -50 }).aporte).toBe(0);
    expect(gerarPlano(base, { aporteEscolhido: -50 }).livre).toBe(EXCEDENTE);
  });

  it("valor sem sentido é ignorado: vale o ritmo", () => {
    const doRitmo = gerarPlano(base).aporte;
    expect(gerarPlano(base, { aporteEscolhido: Number.NaN }).aporte).toBe(doRitmo);
    expect(gerarPlano(base, { aporteEscolhido: Number.POSITIVE_INFINITY }).aporte).toBe(doRitmo);
  });

  it("em modo corte continua zero: não existe aporte pra escolher", () => {
    const apertado: Perfil = { ...base, rendaMensal: 1400 };
    const plano = gerarPlano(apertado, { aporteEscolhido: 500 });
    expect(plano.modoCorte).toBe(true);
    expect(plano.aporte).toBe(0);
    expect(plano.livre).toBe(0);
  });

  it("escolha explícita não é limitada pelo piso — quem avisa é a tela", () => {
    // 1400 de 1500 deixa bem menos que os 10% da renda que o piso protegeria
    const plano = gerarPlano({ ...base, ritmo: "acelerado" }, { aporteEscolhido: 1400 });
    expect(plano.aporte).toBe(1400);
    expect(plano.piso.mordeu).toBe(false);
  });

  it("a soma das alocações continua sendo o aporte, com escolha ou sem", () => {
    for (const escolhido of [0, 123.45, 800, EXCEDENTE]) {
      const plano = gerarPlano(base, { aporteEscolhido: escolhido });
      const soma = plano.alocacoes.reduce((total, a) => total + a.valor, 0);
      expect(soma).toBeCloseTo(plano.aporte, 2);
    }
  });
});
