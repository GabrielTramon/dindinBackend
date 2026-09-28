/*
  GERADO a partir de dindinFrontend/src/domain/aporte-escolhido.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { formatBRL } from "./format";
import { gerarPlano, simularQuitacao } from "./motor";
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

  it("não passa do que sobra nem fica negativo", () => {
    const alto = gerarPlano(base, { aporteEscolhido: 99_999 });
    expect(alto.aporte).toBe(EXCEDENTE);
    expect(alto.livre).toBe(0);
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

  /*
    O piso protege a SUGESTÃO do ritmo, não a escolha: à mão a pessoa pode
    guardar tudo o que sobra ("liberdade total com o dinheiro dela").
  */
  it("escolha explícita passa do teto do ritmo: vale o que ela escolheu, até 100%", () => {
    // o teto do ritmo aqui é 1200 (sobram 300); à mão, 1400 vale 1400
    const plano = gerarPlano({ ...base, ritmo: "acelerado" }, { aporteEscolhido: 1400 });
    expect(plano.piso.teto).toBe(1200);
    expect(plano.aporte).toBe(1400);
    expect(plano.livre).toBe(100);
    // "mordeu" fala do ritmo: com escolha à mão, não há o que explicar
    expect(plano.piso.mordeu).toBe(false);
  });

  it("sem escolha, o ritmo continua segurado pelo piso: nenhuma SUGESTÃO deixa R$ 0", () => {
    const plano = gerarPlano({ ...base, ritmo: "acelerado" });
    expect(plano.aporte).toBeLessThanOrEqual(plano.piso.teto);
    expect(plano.livre).toBeGreaterThan(0);
  });

  it("perfil do print: 1.323 gravado à mão vale 1.323 — tudo guardado, R$ 0 livre por escolha dela", () => {
    const print: Perfil = {
      ...base,
      rendaMensal: 1500,
      custoMoradia: 0,
      gastosFixos: [{ categoria: "mercado", valor: 177 }],
      guardado: 0,
    };
    const plano = gerarPlano({ ...print, aporteEscolhido: 1323 });
    expect(plano.resumo.excedente).toBe(1323);
    expect(plano.aporte).toBe(1323);
    expect(plano.livre).toBe(0);
    expect(gerarPlano({ ...print, aporteEscolhido: 1000 }).aporte).toBe(1000);
    // acima da sobra (a sobra diminuiu depois de gravar), entra na sobra
    expect(gerarPlano({ ...print, aporteEscolhido: 2000 }).aporte).toBe(1323);
  });

  it("a soma das alocações continua sendo o aporte, com escolha ou sem", () => {
    for (const escolhido of [0, 123.45, 800, EXCEDENTE]) {
      const plano = gerarPlano(base, { aporteEscolhido: escolhido });
      const soma = plano.alocacoes.reduce((total, a) => total + a.valor, 0);
      expect(soma).toBeCloseTo(plano.aporte, 2);
    }
  });
});

/*
  "Guardar" zerado (ou apagado) grava aporteEscolhido 0. O plano não guarda
  nada, mas as dívidas continuam sendo pagas pelas parcelas — e o texto não
  pode dizer que os juros vencem quando a parcela vence.
*/
describe("aporteEscolhido 0", () => {
  const emprestimo = { tipo: "emprestimo" as const, saldo: 3000, parcela: 600 };

  it("a dívida cara é projetada só com as parcelas", () => {
    const plano = gerarPlano({ ...base, dividas: [emprestimo] }, { aporteEscolhido: 0 });
    expect(plano.aporte).toBe(0);
    const soParcelas = simularQuitacao(plano.dividas.caras, 0);
    expect(soParcelas).toBe(7);
    expect(plano.dividas.mesesParaQuitarCaras).toBe(soParcelas);
    expect(plano.diagnosticoCaras).toBeNull();
    const passo = plano.proximosPassos.find((t) => t.includes("zera em"))!;
    expect(passo).toMatch(/^Só com as parcelas, o empréstimo zera em 7 meses\./);
    for (const t of plano.proximosPassos) expect(t).not.toContain("crescem mais rápido");
  });

  it("vale também com o fôlego ainda por montar: com nada guardado, nada espera por ele", () => {
    const plano = gerarPlano({ ...base, guardado: 0, dividas: [emprestimo] }, { aporteEscolhido: 0 });
    expect(plano.folego.ok).toBe(false);
    expect(plano.dividas.mesesParaQuitarCaras).toBe(simularQuitacao(plano.dividas.caras, 0));
  });

  it("parcela que não cobre os juros continua sem prazo — e a saída sugerida guarda mais que zero", () => {
    const plano = gerarPlano(
      { ...base, dividas: [{ tipo: "emprestimo", saldo: 3000, parcela: 100 }] },
      { aporteEscolhido: 0 },
    );
    expect(plano.dividas.mesesParaQuitarCaras).toBeNull();
    // o ritmo do próprio perfil entra na busca: é o mais leve que resolve
    expect(plano.diagnosticoCaras?.ritmoQueResolve).toBe("leve");
    const aviso = plano.proximosPassos.find((t) => t.includes("No ritmo leve"))!;
    expect(aviso).toMatch(/^Só com as parcelas, os juros crescem mais rápido do que você paga\./);
    expect(aviso).toContain("que separa uma parte do que sobra");
  });

  it("sem dívida, a reserva diz que nada está sendo guardado — não que espera 'as prioridades de cima'", () => {
    const plano = gerarPlano(base, { aporteEscolhido: 0 });
    expect(plano.degrau).toBe(2);
    expect(plano.reserva.mesesParaCompletar).toBeNull();
    const passo = plano.proximosPassos.find((t) => t.includes("reserva"))!;
    expect(passo).toContain("Com nada sendo guardado por mês");
    expect(passo).not.toContain("prioridades de cima");
  });

  it("o primeiro passo não manda 'separar R$ 0': diz que nada é separado, sem afirmar o valor livre (os potes mudam ele)", () => {
    const plano = gerarPlano(base, { aporteEscolhido: 0 });
    expect(plano.proximosPassos[0]).toBe("Este mês o plano não separa nada: o que sobra é seu pra usar sem culpa.");
    expect(plano.proximosPassos[0]).not.toContain(formatBRL(plano.livre));
    for (const t of plano.proximosPassos) expect(t).not.toContain("Separe");
  });
});

describe("com o Guardar editado, a busca de ritmo compara valores reais", () => {
  /** medido: no leve essa dívida nunca zera; no equilibrado zera em 3 anos */
  const apertado: Perfil = {
    rendaMensal: 3194.76,
    tipoRenda: "clt",
    idade: 22,
    moradia: "pais",
    custoMoradia: 0,
    gastosFixos: [{ categoria: "mercado", valor: 1181.38 }],
    dividas: [{ tipo: "emprestimo", saldo: 21901.62, taxaAnual: 0.9 }],
    guardado: 1000,
  };

  it("o ritmo da própria pessoa entra na busca quando o valor dela não é o do ritmo", () => {
    const leve = gerarPlano({ ...apertado, ritmo: "leve" });
    expect(leve.dividas.mesesParaQuitarCaras).toBeNull();
    // equilibrado, mas guardando o que o leve guardaria: não quita
    const plano = gerarPlano({ ...apertado, ritmo: "equilibrado", aporteEscolhido: leve.aporte });
    expect(plano.dividas.mesesParaQuitarCaras).toBeNull();
    // antes o equilibrado era pulado por ser "o ritmo atual" e a saída virava o acelerado
    expect(plano.diagnosticoCaras?.ritmoQueResolve).toBe("equilibrado");
    const aviso = plano.proximosPassos.find((t) => t.includes("No ritmo equilibrado"))!;
    expect(aviso).toContain(`Guardando ${formatBRL(leve.aporte)} por mês`);
    expect(aviso).toContain(`que guarda mais do que os ${formatBRL(leve.aporte)} de hoje`);
  });

  it("nunca sugere um ritmo que guarda menos do que o valor escolhido", () => {
    const equilibrado = gerarPlano({ ...apertado, ritmo: "equilibrado" });
    const leve = gerarPlano({ ...apertado, ritmo: "leve" });
    // guardando mais que o leve, sem chegar no equilibrado: o leve (que guarda menos) não pode ser a saída
    const escolhido = leve.aporte + 1;
    expect(escolhido).toBeLessThan(equilibrado.aporte);
    const plano = gerarPlano({ ...apertado, ritmo: "acelerado", aporteEscolhido: escolhido });
    const saida = plano.diagnosticoCaras?.ritmoQueResolve;
    expect(saida).not.toBe("leve");
    expect(saida).toBeTruthy();
    expect(gerarPlano({ ...apertado, ritmo: saida! }).aporte).toBeGreaterThan(escolhido);
  });
});
