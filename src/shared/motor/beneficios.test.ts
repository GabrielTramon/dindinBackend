/*
  GERADO a partir de dindinFrontend/src/domain/beneficios.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { aplicarBeneficios, descontoDoValeTransporte, nomeDoBeneficio, valorDoBeneficio } from "./beneficios";
import { gerarPlano } from "./motor";
import { brutoParaLiquido } from "./renda";
import { validarPerfil } from "./schema";
import type { Perfil } from "./types";

/*
  Vale não é dinheiro na conta: entra no plano só até o valor dos gastos fixos
  que ele paga. O resto fica no cartão e nunca vira reserva.
*/

const base: Perfil = {
  rendaMensal: 2500,
  tipoRenda: "clt",
  idade: 22,
  moradia: "pais",
  custoMoradia: 0,
  gastosFixos: [
    { categoria: "mercado", valor: 300 },
    { categoria: "transporte_publico", valor: 200 },
    { categoria: "internet", valor: 100 },
  ],
  dividas: [],
  guardado: 0,
};

describe("aplicarBeneficios", () => {
  it("sem vale, nada muda", () => {
    expect(aplicarBeneficios(undefined, base.gastosFixos)).toEqual({ total: 0, pagaGastos: 0, semUso: 0 });
    expect(aplicarBeneficios([], base.gastosFixos)).toEqual({ total: 0, pagaGastos: 0, semUso: 0 });
  });

  it("o vale paga até o valor do gasto: R$ 800 de VR com R$ 300 de mercado pagam 300", () => {
    expect(aplicarBeneficios([{ tipo: "refeicao", valor: 800 }], base.gastosFixos)).toEqual({
      total: 800,
      pagaGastos: 300,
      semUso: 500,
    });
  });

  it("VR não paga internet nem transporte", () => {
    const gastos = [
      { categoria: "internet", valor: 100 },
      { categoria: "transporte_publico", valor: 200 },
    ];
    expect(aplicarBeneficios([{ tipo: "refeicao", valor: 500 }], gastos).pagaGastos).toBe(0);
  });

  it("VR e VA pagam comida juntos: cada um começa pelo seu e cobre o outro", () => {
    const gastos = [
      { categoria: "refeicao", valor: 300 },
      { categoria: "mercado", valor: 600 },
    ];
    // VR 500 paga a refeição (300) e 200 de mercado; VA 400 paga os outros 400 do mercado
    const r = aplicarBeneficios(
      [
        { tipo: "alimentacao", valor: 400 },
        { tipo: "refeicao", valor: 500 },
      ],
      gastos,
    );
    expect(r).toEqual({ total: 900, pagaGastos: 900, semUso: 0 });
  });

  it("VT paga transporte público e, se sobrar, combustível", () => {
    const gastos = [
      { categoria: "combustivel", valor: 150 },
      { categoria: "transporte_publico", valor: 100 },
      { categoria: "mercado", valor: 400 },
    ];
    expect(aplicarBeneficios([{ tipo: "transporte", valor: 300 }], gastos)).toEqual({
      total: 300,
      pagaGastos: 250,
      semUso: 50,
    });
  });

  it("'outro' paga só o que os vales de antes não pagaram, qualquer que seja a ordem da lista", () => {
    const beneficios = [
      { tipo: "outro" as const, nome: "Home office", valor: 1000 },
      { tipo: "refeicao" as const, valor: 250 },
    ];
    // o VR paga 250 do mercado; o outro paga os 50 que faltam do mercado + transporte + internet
    expect(aplicarBeneficios(beneficios, base.gastosFixos)).toEqual({ total: 1250, pagaGastos: 600, semUso: 650 });
  });

  it("vale estranho (negativo, NaN, zero) conta como nada", () => {
    const r = aplicarBeneficios(
      [
        { tipo: "refeicao", valor: -300 },
        { tipo: "alimentacao", valor: Number.NaN },
        { tipo: "transporte", valor: 0 },
      ],
      base.gastosFixos,
    );
    expect(r).toEqual({ total: 0, pagaGastos: 0, semUso: 0 });
  });

  it("dois vales do mesmo tipo somam", () => {
    expect(
      valorDoBeneficio(
        [
          { tipo: "transporte", valor: 120 },
          { tipo: "transporte", valor: 80 },
          { tipo: "refeicao", valor: 500 },
        ],
        "transporte",
      ),
    ).toBe(200);
  });
});

describe("os vales no plano", () => {
  it("a parte que paga gasto soma no excedente; o custo continua cheio", () => {
    const sem = gerarPlano(base);
    const com = gerarPlano({ ...base, beneficios: [{ tipo: "refeicao", valor: 800 }] });
    expect(com.resumo.custoTotal).toBe(sem.resumo.custoTotal);
    expect(com.resumo.beneficios).toBe(300);
    expect(com.resumo.excedente).toBe(sem.resumo.excedente + 300);
    expect(com.beneficios).toEqual({ total: 800, pagaGastos: 300, semUso: 500 });
  });

  it("a reserva é medida pelo custo cheio: quem perde o emprego perde o vale junto", () => {
    const sem = gerarPlano(base);
    const com = gerarPlano({ ...base, beneficios: [{ tipo: "refeicao", valor: 300 }] });
    expect(com.reserva.alvo).toBe(sem.reserva.alvo);
    expect(com.folego.alvo).toBe(sem.folego.alvo);
  });

  it("o que fica no cartão nunca vira aporte", () => {
    // sem gasto de comida na lista, o VR não paga nada: o plano é o mesmo de sem vale
    const semComida = { ...base, gastosFixos: [{ categoria: "internet", valor: 100 }] };
    const sem = gerarPlano(semComida);
    const com = gerarPlano({ ...semComida, beneficios: [{ tipo: "refeicao", valor: 1000 }] });
    expect(com.aporte).toBe(sem.aporte);
    expect(com.resumo.excedente).toBe(sem.resumo.excedente);
    expect(com.beneficios.semUso).toBe(1000);
  });

  it("vale que paga gasto pode tirar o plano do modo corte", () => {
    const apertado = { ...base, rendaMensal: 550 };
    expect(gerarPlano(apertado).modoCorte).toBe(true);
    const comVale = gerarPlano({
      ...apertado,
      beneficios: [
        { tipo: "alimentacao", valor: 300 },
        { tipo: "transporte", valor: 200 },
      ],
    });
    expect(comVale.modoCorte).toBe(false);
    expect(comVale.resumo.excedente).toBe(450);
  });
});

describe("desconto do vale-transporte", () => {
  it("é 6% do bruto, nunca mais que o próprio vale", () => {
    expect(descontoDoValeTransporte(3000, 400)).toBe(180);
    expect(descontoDoValeTransporte(3000, 100)).toBe(100);
    expect(descontoDoValeTransporte(0, 100)).toBe(0);
    expect(descontoDoValeTransporte(3000, Number.NaN)).toBe(0);
  });

  it("sai do líquido de quem informou o VT, sem mexer em INSS e IRRF", () => {
    const sem = brutoParaLiquido(3000);
    const com = brutoParaLiquido(3000, {}, { valeTransporte: 400 });
    expect(com.inss).toBe(sem.inss);
    expect(com.irrf).toBe(sem.irrf);
    expect(com.valeTransporte).toBe(180);
    expect(com.liquido).toBe(Math.round((sem.liquido - 180) * 100) / 100);
  });

  it("sem VT, o holerite tem a forma de sempre (sem a chave)", () => {
    expect("valeTransporte" in brutoParaLiquido(3000)).toBe(false);
    expect("valeTransporte" in brutoParaLiquido(3000, {}, { valeTransporte: 0 })).toBe(false);
  });
});

describe("schema dos vales", () => {
  const perfil = (beneficios: unknown) => validarPerfil({ ...base, beneficios });

  it("aceita os vales do catálogo e o 'outro' com nome", () => {
    expect(
      perfil([
        { tipo: "refeicao", valor: 600 },
        { tipo: "outro", nome: "Home office", valor: 100 },
      ]).ok,
    ).toBe(true);
  });

  it("'outro' sem nome, valor zero e tipo desconhecido não passam", () => {
    expect(perfil([{ tipo: "outro", valor: 100 }]).ok).toBe(false);
    expect(perfil([{ tipo: "outro", nome: "   ", valor: 100 }]).ok).toBe(false);
    expect(perfil([{ tipo: "refeicao", valor: 0 }]).ok).toBe(false);
    expect(perfil([{ tipo: "gympass", valor: 100 }]).ok).toBe(false);
  });

  it("perfil sem vale continua valendo (campo opcional, sem default)", () => {
    const r = validarPerfil(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect("beneficios" in r.perfil).toBe(false);
  });
});

describe("nomeDoBeneficio", () => {
  it("usa o nome do catálogo, ou o que a pessoa deu ao 'outro'", () => {
    expect(nomeDoBeneficio({ tipo: "transporte" })).toBe("Vale-transporte");
    expect(nomeDoBeneficio({ tipo: "outro", nome: " Auxílio creche " })).toBe("Auxílio creche");
    expect(nomeDoBeneficio({ tipo: "outro", nome: "" })).toBe("Outro benefício");
  });
});
