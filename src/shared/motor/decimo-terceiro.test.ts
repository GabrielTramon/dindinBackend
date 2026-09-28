/*
  GERADO a partir de dindinFrontend/src/domain/decimo-terceiro.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { cartaoDaMeta } from "./cartao-meta";
import { entradasDoDecimo, primeiroMesDoDecimo, valorDoDecimoTerceiro } from "./decimo-terceiro";
import { simularRitmos } from "./divisor";
import { caminhoDoPlano } from "./marcos";
import { gerarPlano } from "./motor";
import { respostaDoPlano } from "./resposta";
import { validarPerfil } from "./schema";
import type { Perfil, Plano } from "./types";
import { formatBRL, formatMeses } from "./format";

/*
  O 13º entra inteiro nas projeções no mês em que cai (dezembro), no passo da
  vez. O mês a mês não muda; os prazos encurtam. Sem ele — ou sem data — a
  conta é a de sempre, igualzinha.
*/

// 28 de setembro de 2026: o próximo 13º cai no mês 4 da projeção (set, out, nov, dez)
const hoje = new Date(2026, 8, 28);
const gastos = (valor: number) => [{ categoria: "mercado", valor }];

const base: Perfil = {
  rendaMensal: 3000,
  tipoRenda: "clt",
  idade: 24,
  moradia: "pais",
  custoMoradia: 0,
  gastosFixos: gastos(2000),
  dividas: [],
  guardado: 1000,
};

/** O que os prazos de um plano dizem — pra comparar dois planos de uma vez. */
const prazos = (p: Plano) => ({
  folego: p.folego,
  reserva: p.reserva,
  dividas: p.dividas,
  aporte: p.aporte,
  alocacoes: p.alocacoes,
  diagnostico: p.diagnosticoCaras,
});

describe("valorDoDecimoTerceiro", () => {
  it("é o líquido de um mês, pra quem usa no plano", () => {
    expect(valorDoDecimoTerceiro({ ...base, decimoTerceiro: true })).toBe(3000);
    expect(valorDoDecimoTerceiro({ ...base, tipoRenda: "pj", decimoTerceiro: true })).toBe(3000);
  });

  it("é 0 sem resposta, com 'não' e pra informal (mesmo com um 'sim' antigo)", () => {
    expect(valorDoDecimoTerceiro(base)).toBe(0);
    expect(valorDoDecimoTerceiro({ ...base, decimoTerceiro: false })).toBe(0);
    expect(valorDoDecimoTerceiro({ ...base, tipoRenda: "informal", decimoTerceiro: true })).toBe(0);
  });

  it("devolve o desconto do VT de quem informou o bruto: ele não sai do 13º", () => {
    const perfil = {
      ...base,
      decimoTerceiro: true,
      rendaInformada: "bruta" as const,
      salarioBruto: 3500,
      rendaMensal: 2981.4,
      beneficios: [{ tipo: "transporte" as const, valor: 220 }],
    };
    // 6% de 3.500 = 210 (menor que o vale)
    expect(valorDoDecimoTerceiro(perfil)).toBe(3191.4);
  });
});

describe("primeiroMesDoDecimo", () => {
  it("conta os meses até dezembro, com este mês sendo o 1", () => {
    expect(primeiroMesDoDecimo(new Date(2026, 8, 28))).toBe(4);
    expect(primeiroMesDoDecimo(new Date(2026, 10, 5))).toBe(2);
    expect(primeiroMesDoDecimo(new Date(2027, 0, 10))).toBe(12);
  });

  it("em dezembro, até o dia 20 é este mês; depois, o do ano que vem", () => {
    expect(primeiroMesDoDecimo(new Date(2026, 11, 20))).toBe(1);
    expect(primeiroMesDoDecimo(new Date(2026, 11, 21))).toBe(13);
  });

  it("data inválida não inventa mês", () => {
    expect(primeiroMesDoDecimo(new Date(Number.NaN))).toBeNull();
  });

  it("depois do primeiro, cai a cada 12 meses", () => {
    const porMes = entradasDoDecimo({ valor: 100, primeiroMes: 4 })!;
    expect([1, 3, 4, 5, 15, 16, 28].map(porMes)).toEqual([0, 0, 100, 0, 0, 100, 100]);
    expect(entradasDoDecimo({ valor: 0, primeiroMes: 4 })).toBeNull();
    expect(entradasDoDecimo({ valor: 100, primeiroMes: null })).toBeNull();
  });
});

describe("sem o 13º, nada muda", () => {
  const perfis: Perfil[] = [
    base,
    { ...base, guardado: 0 },
    { ...base, gastosFixos: gastos(1500), dividas: [{ tipo: "rotativo", saldo: 5000 }] },
    { ...base, gastosFixos: gastos(1500), dividas: [{ tipo: "financiamento", saldo: 20000, parcela: 400 }] },
    { ...base, gastosFixos: gastos(1000), guardado: 10000, meta: { tipo: "viagem", valorAlvo: 10000 } },
    { ...base, aporteEscolhido: 0 },
  ];

  it("a data sozinha não muda prazo nenhum", () => {
    for (const p of perfis) expect(prazos(gerarPlano(p, { hoje }))).toEqual(prazos(gerarPlano(p)));
  });

  it("'não' e informal com 'sim' dão o plano de quem não respondeu", () => {
    for (const p of perfis) {
      const sem = prazos(gerarPlano(p, { hoje }));
      expect(prazos(gerarPlano({ ...p, decimoTerceiro: false }, { hoje }))).toEqual(sem);
      expect(gerarPlano({ ...p, decimoTerceiro: false }, { hoje }).decimoTerceiro).toBeNull();
      const informal = { ...p, tipoRenda: "informal" as const };
      expect(prazos(gerarPlano({ ...informal, decimoTerceiro: true }, { hoje }))).toEqual(
        prazos(gerarPlano(informal, { hoje })),
      );
    }
  });

  it("sem data, o 13º fica de fora dos prazos (e o plano diz que não sabe o mês)", () => {
    for (const p of perfis) {
      const com = gerarPlano({ ...p, decimoTerceiro: true });
      expect(prazos(com)).toEqual(prazos(gerarPlano(p)));
      expect(com.decimoTerceiro).toMatchObject({ valor: 3000, primeiroMes: null, destino: null });
    }
  });
});

describe("o 13º nos prazos", () => {
  it("o mês a mês não muda: só os prazos", () => {
    const sem = gerarPlano(base, { hoje });
    const com = gerarPlano({ ...base, decimoTerceiro: true }, { hoje });
    expect(com.aporte).toBe(sem.aporte);
    expect(com.livre).toBe(sem.livre);
    expect(com.alocacoes).toEqual(sem.alocacoes);
  });

  it("encurta a reserva: R$ 5.000 a R$ 500 por mês eram 10 meses; com R$ 3.000 em dezembro, 4", () => {
    const sem = gerarPlano(base, { hoje });
    const com = gerarPlano({ ...base, decimoTerceiro: true }, { hoje });
    expect(sem.degrau).toBe(2);
    expect(sem.aporte).toBe(500);
    expect(sem.reserva.mesesParaCompletar).toBe(10);
    // set 500 · out 500 · nov 500 · dez 500 + 3.000 = 5.000
    expect(com.reserva.mesesParaCompletar).toBe(4);
    expect(com.decimoTerceiro).toEqual({ valor: 3000, primeiroMes: 4, destino: "reserva", sobraParaAMeta: 0 });
  });

  it("fecha o fôlego mesmo com o Guardar em 0%", () => {
    const zerado = { ...base, guardado: 0, aporteEscolhido: 0 };
    expect(gerarPlano(zerado, { hoje }).folego.mesesParaCompletar).toBeNull();
    const com = gerarPlano({ ...zerado, decimoTerceiro: true }, { hoje });
    expect(com.folego.mesesParaCompletar).toBe(4);
    expect(com.decimoTerceiro?.destino).toBe("folego");
    // o cartão do topo diz o prazo, não "Parado"
    const r = respostaDoPlano(com, { simulacoes: [], hoje });
    expect(r.modo === "plano" && r.tempo.tipo).toBe("prazo");
  });

  it("quita no ano uma dívida que o mês a mês não vence", () => {
    const perfil: Perfil = { ...base, gastosFixos: gastos(1500), aporteEscolhido: 0, dividas: [{ tipo: "rotativo", saldo: 1500 }] };
    const sem = gerarPlano(perfil, { hoje });
    expect(sem.dividas.mesesParaQuitarCaras).toBeNull();
    const com = gerarPlano({ ...perfil, decimoTerceiro: true }, { hoje });
    expect(com.dividas.mesesParaQuitarCaras).toBe(4);
    expect(com.diagnosticoCaras).toBeNull();
  });

  it("o que sobra do 13º depois de quitar a dívida vai pra reserva no mesmo mês", () => {
    // cartão de R$ 2.500 com R$ 1.050 por mês: zera no mês 4 dos dois jeitos
    const perfil: Perfil = { ...base, gastosFixos: gastos(1500), dividas: [{ tipo: "rotativo", saldo: 2500 }] };
    const sem = gerarPlano(perfil, { hoje });
    const com = gerarPlano({ ...perfil, decimoTerceiro: true }, { hoje });
    expect(sem.dividas.mesesParaQuitarCaras).toBe(4);
    expect(com.dividas.mesesParaQuitarCaras).toBe(4);
    expect(com.decimoTerceiro?.destino).toBe("divida_cara");
    // reserva: faltam 3.500 a R$ 750 por mês. Sem 13º, 5 meses depois do cartão (9);
    // com ele, os R$ 3.000 que passaram do cartão já entram em dezembro e falta 1 mês
    expect(sem.reserva.mesesParaCompletar).toBe(9);
    expect(com.reserva.mesesParaCompletar).toBe(5);
  });

  it("o que sobra do 13º quando a reserva fecha já começa a meta", () => {
    const perfil: Perfil = { ...base, guardado: 2000, meta: { tipo: "viagem", valorAlvo: 3000 } };
    const sem = gerarPlano(perfil, { hoje });
    const com = gerarPlano({ ...perfil, decimoTerceiro: true }, { hoje });
    // reserva: faltam 4.000; em dezembro, 2.000 do mês a mês + 3.000 do 13º → sobram 1.000
    expect(com.reserva.mesesParaCompletar).toBe(4);
    expect(com.decimoTerceiro?.sobraParaAMeta).toBe(1000);
    // meta de 3.000 a R$ 300 por mês depois da reserva: sem 13º, 8 + 10 = 18;
    // com ele, começa com 1.000 em dezembro e faltam 2.000 = mais 7 meses → 11
    expect(caminhoDoPlano(sem, { hoje }).meta?.projecao.meses).toBe(18);
    expect(caminhoDoPlano(com, { hoje }).meta?.projecao.meses).toBe(11);
  });

  it("no degrau 4 vai direto pra meta, e o cartão, o caminho e o ritmo dizem o mesmo prazo", () => {
    const perfil: Perfil = {
      ...base,
      gastosFixos: gastos(1000),
      guardado: 10000,
      decimoTerceiro: true,
      meta: { tipo: "viagem", valorAlvo: 10000 },
    };
    const plano = gerarPlano(perfil, { hoje });
    expect(plano.degrau).toBe(4);
    expect(plano.aporte).toBe(600);
    const caminho = caminhoDoPlano(plano, { hoje });
    // sem 13º: 10.000 / 600 = 17 meses; com: 2.400 + 3.000 em dezembro, e 600 por mês → 12
    expect(caminho.meta?.projecao.meses).toBe(12);
    const r = respostaDoPlano(plano, {
      projecaoMeta: caminho.meta?.projecao,
      simulacoes: simularRitmos(perfil, { hoje }),
      hoje,
    });
    if (r.modo !== "plano" || r.tempo.tipo !== "prazo") throw new Error("esperava prazo");
    expect(r.tempo.meses).toBe(12);
    const equilibrado = r.segmentos.find((s) => s.ritmo === "equilibrado")!;
    expect(equilibrado.descricaoSr).toContain(formatMeses(12));
    expect(r.decimo).toBe(`Os prazos já contam com o 13º: em dezembro de 2026, cerca de ${formatBRL(3000)} vão pra Viagem.`);
  });

  it("'Sua meta' explica o prazo: o 13º aparece no 'como chega'", () => {
    const perfil: Perfil = { ...base, guardado: 2000, decimoTerceiro: true, meta: { tipo: "viagem", valorAlvo: 3000 } };
    const plano = gerarPlano(perfil, { hoje });
    const noCaminho = caminhoDoPlano(plano, { hoje }).meta!;
    expect(noCaminho.decimoPorAno).toBe(3000);
    expect(cartaoDaMeta(perfil.meta!, noCaminho, hoje).como).toContain(`mais o 13º (${formatBRL(3000)}) todo dezembro`);
    // sem 13º, a frase de sempre
    const sem = caminhoDoPlano(gerarPlano({ ...perfil, decimoTerceiro: false }, { hoje }), { hoje }).meta!;
    expect("decimoPorAno" in sem).toBe(false);
    expect(cartaoDaMeta(perfil.meta!, sem, hoje).como).not.toContain("13º");
  });

  it("sem meta, o 'em 1 ano' soma o 13º", () => {
    const perfil: Perfil = { ...base, gastosFixos: gastos(1000), guardado: 10000, decimoTerceiro: true };
    const plano = gerarPlano(perfil, { hoje });
    const r = respostaDoPlano(plano, { simulacoes: [], hoje });
    if (r.modo !== "plano" || r.tempo.tipo !== "ano") throw new Error("esperava ano");
    expect(r.tempo.valor).toBe(600 * 12 + 3000);
  });

  it("o cartão diz pra onde o 13º vai", () => {
    const r = respostaDoPlano(gerarPlano({ ...base, decimoTerceiro: true }, { hoje }), { simulacoes: [], hoje });
    expect(r.modo === "plano" && r.decimo).toBe(
      `Os prazos já contam com o 13º: em dezembro de 2026, cerca de ${formatBRL(3000)} vão pra reserva.`,
    );
    const sem = respostaDoPlano(gerarPlano(base, { hoje }), { simulacoes: [], hoje });
    expect(sem.modo === "plano" && sem.decimo).toBeUndefined();
  });
});

describe("schema", () => {
  it("aceita sim e não; perfil sem a resposta continua valendo", () => {
    expect(validarPerfil({ ...base, decimoTerceiro: true }).ok).toBe(true);
    expect(validarPerfil({ ...base, decimoTerceiro: false }).ok).toBe(true);
    expect(validarPerfil({ ...base, decimoTerceiro: "sim" }).ok).toBe(false);
    const r = validarPerfil(base);
    expect(r.ok && "decimoTerceiro" in r.perfil).toBe(false);
  });
});
