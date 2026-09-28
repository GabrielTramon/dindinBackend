/*
  GERADO a partir de dindinFrontend/src/domain/caminho.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { LIMIAR_DIVIDA_CARA, proporcaoAporte } from "./config";
import { avaliarDividas, gerarPlano, simularQuitacao } from "./motor";
import { RITMOS } from "./schema";
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
    // uma dívida só: o verbo concorda com ela
    expect(p.proximosPassos.some((t) => t.includes("o rotativo do cartão zera em"))).toBe(true);
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
    const aporte0 = p.resumo.excedente * proporcaoAporte(p.perfil.ritmo, 0);
    const mesesFolego = Math.ceil(p.folego.falta / aporte0);
    const faltaDepois = p.reserva.falta - mesesFolego * aporte0;
    const aporte2 = p.resumo.excedente * proporcaoAporte(p.perfil.ritmo, 2);
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

describe("o ritmo atravessa as projeções", () => {
  /** sobra pouca coisa em relação à renda: é onde o piso do acelerado morde */
  const apertado: Perfil = {
    ...base,
    rendaMensal: 4000,
    custoMoradia: 2000,
    gastosFixos: gastos(1500),
    guardado: 2000,
  };

  it("a projeção usa o aporte que o piso deixou, não o que o ritmo pediu", () => {
    const acelerado = gerarPlano({ ...apertado, ritmo: "acelerado" });
    const equilibrado = gerarPlano({ ...apertado, ritmo: "equilibrado" });
    expect(acelerado.degrau).toBe(2);
    expect(acelerado.piso.mordeu).toBe(true);
    expect(acelerado.aporte).toBe(equilibrado.aporte);
    // mesmo aporte efetivo, mesmo prazo. Se a projeção lesse a tabela do
    // acelerado em vez do aporte, a reserva fecharia antes no papel e o plano
    // estaria mentindo sobre o próprio número que mandou guardar.
    expect(acelerado.reserva.mesesParaCompletar).toBe(
      Math.ceil(acelerado.reserva.falta / acelerado.aporte),
    );
    expect(acelerado.reserva.mesesParaCompletar).toBe(equilibrado.reserva.mesesParaCompletar);
  });

  it("no leve o fôlego demora mais e a dívida cara é projetada com o ritmo leve", () => {
    const comDivida = { ...base, dividas: [{ tipo: "rotativo", saldo: 2000 } as const] };
    const leve = gerarPlano({ ...comDivida, ritmo: "leve" });
    const acelerado = gerarPlano({ ...comDivida, ritmo: "acelerado" });
    expect(leve.degrau).toBe(0);
    expect(leve.aporte).toBe(540); // 1200 × 0,45
    expect(acelerado.aporte).toBe(900); // 1200 × 0,75, dentro da margem
    expect(leve.dividas.mesesParaQuitarCaras!).toBeGreaterThan(
      acelerado.dividas.mesesParaQuitarCaras!,
    );
  });

  it("quando o ritmo de hoje não quita mas outro quita, o plano diz qual e em quanto tempo", () => {
    const naoQuitaNoLeve: Perfil = {
      ...base,
      rendaMensal: 3194.76,
      custoMoradia: 0,
      moradia: "pais",
      gastosFixos: gastos(1181.38),
      dividas: [{ tipo: "emprestimo", saldo: 21901.62, taxaAnual: 0.9 }],
      guardado: 1000,
    };
    const leve = gerarPlano({ ...naoQuitaNoLeve, ritmo: "leve" });
    const equilibrado = gerarPlano({ ...naoQuitaNoLeve, ritmo: "equilibrado" });
    expect(leve.degrau).toBe(1);
    expect(leve.dividas.mesesParaQuitarCaras).toBeNull();
    expect(equilibrado.dividas.mesesParaQuitarCaras).not.toBeNull();
    expect(leve.diagnosticoCaras).toEqual({
      motivo: "juros",
      ritmoQueResolve: "equilibrado",
      mesesNoRitmoQueResolve: equilibrado.dividas.mesesParaQuitarCaras,
      // um ritmo resolve: não há por que falar em guardar 100%
      guardandoTudo: null,
    });
    // o ritmo que resolve é o mais lento que resolve, não o mais rápido de todos
    expect(equilibrado.diagnosticoCaras).toBeNull();
  });

  it("quando nenhum ritmo quita, não há saída por ritmo", () => {
    const p = gerarPlano({ ...base, dividas: [{ tipo: "rotativo", saldo: 40000 }], ritmo: "leve" });
    expect(p.dividas.mesesParaQuitarCaras).toBeNull();
    expect(p.diagnosticoCaras).toEqual({
      motivo: "juros",
      ritmoQueResolve: null,
      mesesNoRitmoQueResolve: null,
      // nem guardando tudo o que sobra os 40 mil zeram
      guardandoTudo: null,
    });
    for (const ritmo of RITMOS) {
      expect(gerarPlano({ ...base, dividas: [{ tipo: "rotativo", saldo: 40000 }], ritmo })
        .dividas.mesesParaQuitarCaras).toBeNull();
    }
  });

  it("com prazo, sem dívida cara, ou em modo corte, não há diagnóstico", () => {
    expect(gerarPlano({ ...base, dividas: [{ tipo: "rotativo", saldo: 2000 }] }).diagnosticoCaras).toBeNull();
    expect(gerarPlano(base).diagnosticoCaras).toBeNull();
    // em corte o problema não é o ritmo: quem fala é o plano de corte
    const corte = gerarPlano({
      ...base,
      gastosFixos: gastos(2500),
      dividas: [{ tipo: "rotativo", saldo: 500 }],
    });
    expect(corte.modoCorte).toBe(true);
    expect(corte.diagnosticoCaras).toBeNull();
  });
});

describe("classificação e sobra de parcela", () => {
  it("dívida acima do limiar mas abaixo da taxa livre de risco é barata", () => {
    const [d] = avaliarDividas([{ tipo: "outra", saldo: 1000, taxaAnual: LIMIAR_DIVIDA_CARA + 0.02 }], LIMIAR_DIVIDA_CARA + 0.05);
    expect(d.classe).toBe("barata");
  });

  it("a sobra da parcela no mês em que a dívida zera reforça a próxima no mesmo mês", () => {
    // sem juros: A = 250 com parcela 100 (no mês 3 deve só 50: sobram 50), B = 50 sem parcela e sem extra.
    // Se a sobra só entrasse no mês seguinte, B zeraria no mês 4.
    const [a, b] = avaliarDividas([
      { tipo: "outra", saldo: 250, taxaAnual: 0, parcela: 100 },
      { tipo: "outra", saldo: 50, taxaAnual: 0 },
    ]);
    expect(simularQuitacao([a, b], 0)).toBe(3);
  });
});

describe("parcela maior que o saldo", () => {
  it("o motor limita a parcela ao saldo: ninguém paga por mês mais do que deve no total", () => {
    const [d] = avaliarDividas([{ tipo: "rotativo", saldo: 1000, parcela: 5000 }]);
    expect(d.parcela).toBe(1000);
    const p = gerarPlano({ ...base, dividas: [{ tipo: "rotativo", saldo: 1000, parcela: 5000 }] });
    expect(p.resumo.parcelas).toBe(1000);
  });

  it("parcela ausente continua ausente", () => {
    const [d] = avaliarDividas([{ tipo: "rotativo", saldo: 1000 }]);
    expect(d).not.toHaveProperty("parcela");
  });
});

/*
  Quando a dívida cara zera, a parcela dela sai do orçamento: a sobra cresce e o
  aporte da reserva cresce junto. Projetar a reserva com a sobra apertada de hoje
  prometia "4 anos e 4 meses" pra algo que fecha em pouco mais de um ano.
*/
describe("a reserva depois da dívida cara usa a parcela liberada", () => {
  const comEmprestimo: Perfil = {
    rendaMensal: 3000,
    tipoRenda: "clt",
    idade: 24,
    moradia: "aluguel",
    custoMoradia: 800,
    gastosFixos: gastos(500),
    dividas: [{ tipo: "emprestimo", saldo: 5000, parcela: 1400 }],
    guardado: 1000,
  };

  it("excedente 300 hoje; 1.700 quando o empréstimo zera → reserva em 4 + ⌈7.100 / 850⌉ = 13 meses", () => {
    const p = gerarPlano(comEmprestimo);
    expect(p.degrau).toBe(1);
    expect(p.resumo.excedente).toBe(300);
    expect(p.dividas.mesesParaQuitarCaras).toBe(4);
    expect(p.reserva).toMatchObject({ alvo: 8100, falta: 7100 });
    // o equilibrado guarda metade da sobra na reserva: 1.700 × 0,5 = 850
    const aporteDepois = Math.floor(1700 * proporcaoAporte("equilibrado", 2));
    expect(p.reserva.mesesParaCompletar).toBe(4 + Math.ceil(7100 / aporteDepois));
    expect(p.reserva.mesesParaCompletar).toBe(13);
  });

  it("sem parcela informada nada muda: o aporte depois das caras é o de hoje", () => {
    const p = gerarPlano({ ...comEmprestimo, dividas: [{ tipo: "rotativo", saldo: 1000 }] });
    const aporte2 = Math.floor(p.resumo.excedente * proporcaoAporte("equilibrado", 2));
    const caras = p.dividas.mesesParaQuitarCaras!;
    expect(p.reserva.mesesParaCompletar).toBe(caras + Math.ceil(p.reserva.falta / aporte2));
  });

  it("a dívida média também começa a ser antecipada com a parcela da cara de volta", () => {
    const comMedia: Perfil = {
      ...comEmprestimo,
      dividas: [...comEmprestimo.dividas, { tipo: "financiamento", saldo: 20000, parcela: 600 }],
      rendaMensal: 3600,
    };
    const p = gerarPlano(comMedia);
    const inicio = p.reserva.mesesParaCompletar!;
    const excedenteDepois = p.resumo.excedente + 1400;
    // a reserva usou a sobra com a parcela de volta…
    const aporte2 = Math.floor(excedenteDepois * proporcaoAporte("equilibrado", 2));
    expect(inicio).toBe(p.dividas.mesesParaQuitarCaras! + Math.ceil(p.reserva.falta / aporte2));
    // …e a média também: extra zero até a reserva fechar, depois o aporte do degrau 3 sobre a sobra maior
    const aporte3 = Math.floor(excedenteDepois * proporcaoAporte("equilibrado", 3));
    const esperado = simularQuitacao(p.dividas.medias, {
      extra: (mes) => (mes > inicio ? aporte3 : 0),
      regimeAPartirDe: inicio + 1,
    });
    expect(esperado).not.toBeNull();
    expect(p.dividas.mesesParaQuitarMedias).toBe(esperado);
  });
});

/*
  Aporte em reais inteiros: a tela mostra dinheiro sem centavos, e "Separe
  R$ 578 … O que fica — R$ 1.073" somava um real a mais do que a sobra.
*/
describe("aporte + livre fecham no excedente exibido", () => {
  it("ritmo leve na reserva (0,35 × 1.650 = 577,5): aporte 577, livre 1.073", () => {
    const p = gerarPlano({
      rendaMensal: 2500,
      tipoRenda: "clt",
      idade: 22,
      moradia: "pais",
      custoMoradia: 0,
      gastosFixos: gastos(850),
      dividas: [],
      guardado: 1000,
      ritmo: "leve",
    });
    expect(p.degrau).toBe(2);
    expect(p.resumo.excedente).toBe(1650);
    expect(p.aporte).toBe(577);
    expect(p.livre).toBe(1073);
    expect(p.proximosPassos[0]).toContain("Separe R$\u00a0577");
    // o passo n\u00e3o afirma quanto fica livre: os potes da pessoa mudam esse n\u00famero
    // (quem diz o valor \u00e9 o cart\u00e3o, que conhece os potes)
    expect(p.proximosPassos[0]).not.toContain("R$\u00a01.073");
  });

  it("em qualquer ritmo e renda com centavos, os valores arredondados somam o excedente arredondado", () => {
    for (const renda of [2345.67, 3194.76, 1999.99, 4200.5]) {
      for (const ritmo of RITMOS) {
        for (const guardado of [0, 1000, 20000]) {
          const p = gerarPlano({ ...base, rendaMensal: renda, ritmo, guardado });
          if (p.modoCorte) continue;
          expect(Number.isInteger(p.aporte)).toBe(true);
          expect(p.aporte + Math.round(p.livre)).toBe(Math.round(p.resumo.excedente));
          expect(p.livre).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
