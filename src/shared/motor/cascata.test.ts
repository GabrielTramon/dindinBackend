/*
  GERADO a partir de dindinFrontend/src/domain/cascata.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { arredondar, formatBRL } from "./format";
import {
  FOLEGO_PISO,
  FOLEGO_TETO,
  MARGEM_MINIMA_CORTE,
  MULTIPLICADOR_RESERVA,
  PROPORCAO_APORTE,
  proporcaoAporte,
} from "./config";
import { gerarPlano } from "./motor";
import { RITMOS } from "./schema";
import type { Degrau, Destino, Perfil, Plano, Ritmo } from "./types";
/** Açúcar dos testes: um gasto fixo único, pra cenários que só olham o total. */
const gastos = (valor: number) => (valor > 0 ? [{ categoria: "mercado", valor }] : []);


/*
  A cascata, cenário a cenário, na pele da persona (18–30, começando a trabalhar).
  Cada teste afirma degrau, aporte, livre, alocações (destino E valor) e a
  palavra-chave da decisão. Regra protegida:
    00 fôlego → 01 dívida cara → 02 reserva → 03 dívida média → 04 metas
  Um degrau só recebe quando o anterior está satisfeito. Excedente ≤ 0 = corte.
*/

const base: Perfil = {
  rendaMensal: 2500,
  tipoRenda: "clt",
  idade: 22,
  moradia: "pais",
  custoMoradia: 0,
  gastosFixos: gastos(900),
  dividas: [],
  guardado: 0,
};

const perfil = (over: Partial<Perfil> = {}): Perfil => ({ ...base, ...over });

const somaAlocacoes = (p: Plano) => p.alocacoes.reduce((acc, a) => acc + a.valor, 0);
const destinos = (p: Plano) => p.alocacoes.map((a) => a.destino);

/** o primeiro degrau insatisfeito é quem recebe primeiro */
const DESTINO_DO_DEGRAU: Record<Degrau, Destino> = {
  0: "folego",
  1: "divida_cara",
  2: "reserva",
  3: "divida_media",
  4: "metas",
};
const ORDEM_CASCATA: Destino[] = ["folego", "divida_cara", "reserva", "divida_media", "metas"];

/**
 * O aporte esperado, recalculado à mão a partir da especificação: o ritmo pede
 * uma fração do excedente e o piso do que fica livre segura o pedido. Escrito
 * de novo aqui de propósito — se o teste chamasse a função do motor, provaria
 * só que ela é igual a si mesma.
 */
function aporteEsperado(p: Plano): number {
  const sugerido = p.resumo.excedente * proporcaoAporte(p.perfil.ritmo, p.degrau);
  const tetoPeloLivre = Math.max(0, p.resumo.excedente - p.resumo.renda * MARGEM_MINIMA_CORTE);
  const teto = Math.max(tetoPeloLivre, p.resumo.excedente * PROPORCAO_APORTE.equilibrado[p.degrau]);
  return Math.min(sugerido, teto);
}

/**
 * O aporte vai em reais inteiros, arredondado pra baixo: a tela mostra dinheiro
 * sem centavos, e só assim aporte + livre exibidos fecham no excedente exibido.
 */
const emReais = (v: number) => Math.floor(arredondar(v) + 1e-6);

/** invariantes que valem pra qualquer plano com excedente > 0 */
function esperarInvariantes(p: Plano) {
  expect(p.modoCorte).toBe(false);
  expect(p.corte).toBeNull();
  // aporte é o excedente × proporção (com piso), em reais inteiros arredondados pra baixo
  expect(Number.isInteger(p.aporte)).toBe(true);
  expect(p.aporte).toBe(emReais(aporteEsperado(p)));
  // o piso nunca faz guardar menos do que o equilibrado guardaria neste degrau (a menos do real cortado)
  const equilibrado = p.resumo.excedente * PROPORCAO_APORTE.equilibrado[p.degrau];
  const pedido = p.resumo.excedente * proporcaoAporte(p.perfil.ritmo, p.degrau);
  expect(p.aporte).toBeGreaterThanOrEqual(emReais(Math.min(pedido, equilibrado)));
  // e nunca faz guardar MAIS do que o ritmo pediu
  expect(p.aporte).toBeLessThanOrEqual(pedido + 0.0051);
  // sobra pelo menos a margem mínima da renda, ou o que o equilibrado deixaria
  const livreDoEquilibrado = p.resumo.excedente - equilibrado;
  expect(p.livre).toBeGreaterThanOrEqual(
    Math.min(p.resumo.renda * MARGEM_MINIMA_CORTE, livreDoEquilibrado) - 0.0051,
  );
  expect(Math.abs(p.aporte + p.livre - p.resumo.excedente)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(somaAlocacoes(p) - p.aporte)).toBeLessThanOrEqual(0.01);
  expect(p.alocacoes.length).toBeGreaterThan(0);
  expect(p.alocacoes[0].destino).toBe(DESTINO_DO_DEGRAU[p.degrau]);
  for (const a of p.alocacoes) expect(a.valor).toBeGreaterThan(0);
  // destinos em ordem estrita da cascata, sem repetição
  const idx = destinos(p).map((d) => ORDEM_CASCATA.indexOf(d));
  for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
}

describe("cascata — cenários da persona", () => {
  it("salário mínimo morando com os pais, sem dívida, sem reserva → degrau 0, tudo pro fôlego", () => {
    const p = gerarPlano(perfil({ rendaMensal: 1600, gastosFixos: gastos(600) }));
    expect(p.resumo.custoTotal).toBe(600);
    expect(p.resumo.excedente).toBe(1000);
    expect(p.degrau).toBe(0);
    expect(p.folego).toMatchObject({ alvo: 600, atual: 0, falta: 600, ok: false });
    expect(p.aporte).toBe(600);
    expect(p.livre).toBe(400);
    expect(p.alocacoes).toHaveLength(1);
    expect(p.alocacoes[0]).toMatchObject({ destino: "folego", valor: 600 });
    expect(p.decisao.titulo.toLowerCase()).toContain("fôlego");
    esperarInvariantes(p);
  });

  it("rotativo alto com fôlego ok → degrau 1, 100% do aporte pra dívida", () => {
    const p = gerarPlano(
      perfil({
        rendaMensal: 3000,
        moradia: "aluguel",
        custoMoradia: 1000,
        gastosFixos: gastos(800),
        dividas: [{ tipo: "rotativo", saldo: 4000 }],
        guardado: 1000,
      }),
    );
    expect(p.resumo.excedente).toBe(1200);
    expect(p.folego.alvo).toBe(FOLEGO_TETO);
    expect(p.folego.ok).toBe(true);
    expect(p.reserva.ok).toBe(false);
    expect(p.degrau).toBe(1);
    expect(p.aporte).toBe(840);
    expect(p.livre).toBe(360);
    expect(p.alocacoes).toEqual([expect.objectContaining({ destino: "divida_cara", valor: 840 })]);
    expect(p.decisao.titulo.toLowerCase()).toContain("quitar");
    expect(p.decisao.titulo).toContain("rotativo");
    // o aporte inteiro foi pra dívida: a reserva só começa depois que ela zerar
    expect(p.dividas.mesesParaQuitarCaras).not.toBeNull();
    expect(p.reserva.mesesParaCompletar).toBeGreaterThan(p.dividas.mesesParaQuitarCaras!);
    esperarInvariantes(p);
  });

  it("rotativo alto SEM fôlego → degrau 0: fôlego primeiro, o resto vai pra dívida no MESMO mês", () => {
    const p = gerarPlano(
      perfil({
        rendaMensal: 3000,
        moradia: "aluguel",
        custoMoradia: 1000,
        gastosFixos: gastos(800),
        dividas: [{ tipo: "rotativo", saldo: 1000 }],
        guardado: 500,
      }),
    );
    expect(p.degrau).toBe(0);
    expect(p.folego).toMatchObject({ alvo: 1000, atual: 500, falta: 500, ok: false });
    expect(p.aporte).toBe(720);
    expect(p.livre).toBe(480);
    expect(p.alocacoes).toHaveLength(2);
    expect(p.alocacoes[0]).toMatchObject({ destino: "folego", valor: 500 });
    expect(p.alocacoes[1]).toMatchObject({ destino: "divida_cara", valor: 220 });
    // a reserva não recebe nada enquanto há dívida cara
    expect(destinos(p)).not.toContain("reserva");
    expect(p.decisao.titulo.toLowerCase()).toContain("fôlego");
    expect(typeof p.dividas.mesesParaQuitarCaras).toBe("number");
    esperarInvariantes(p);
  });

  it.each([
    ["pj", 6],
    ["informal", 6],
    ["clt", 3],
  ] as const)("%s sem reserva → multiplicador %i", (tipoRenda, mult) => {
    const p = gerarPlano(perfil({ tipoRenda, guardado: 1000 }));
    expect(MULTIPLICADOR_RESERVA[tipoRenda]).toBe(mult);
    expect(p.reserva.multiplicador).toBe(mult);
    expect(p.reserva.alvo).toBe(mult * p.resumo.custoTotal);
    expect(p.folego.ok).toBe(true);
    expect(p.degrau).toBe(2);
    expect(p.alocacoes[0].destino).toBe("reserva");
    expect(p.decisao.titulo.toLowerCase()).toContain("reserva");
    expect(p.decisao.texto).toContain(`${mult} meses`);
    esperarInvariantes(p);
  });

  it("mora com os pais e sobra muito, tudo resolvido → degrau 4, alocação metas", () => {
    const p = gerarPlano(perfil({ guardado: 10000 }));
    expect(p.folego.ok).toBe(true);
    expect(p.reserva.ok).toBe(true);
    expect(p.degrau).toBe(4);
    expect(p.aporte).toBe(480);
    expect(p.livre).toBe(1120);
    expect(p.alocacoes).toEqual([expect.objectContaining({ destino: "metas", valor: 480 })]);
    expect(p.decisao.titulo.toLowerCase()).toContain("meta");
    esperarInvariantes(p);
  });

  describe("excedente negativo → modo corte", () => {
    it("aporte 0, livre 0, sem alocações, sem renegociar nem moradia quando não se aplicam", () => {
      const p = gerarPlano(perfil({ rendaMensal: 1500, gastosFixos: gastos(1700) }));
      expect(p.modoCorte).toBe(true);
      expect(p.aporte).toBe(0);
      expect(p.livre).toBe(0);
      expect(p.alocacoes).toEqual([]);
      expect(p.corte).not.toBeNull();
      expect(p.corte!.deficit).toBe(200);
      expect(p.corte!.metaCorte).toBe(200 + 1500 * MARGEM_MINIMA_CORTE);
      const s = p.corte!.sugestoes;
      expect(s.some((t) => t.includes("Renegociar"))).toBe(false);
      expect(s.some((t) => t.includes("Moradia"))).toBe(false);
      // com gastos separados, a sugestão nomeia onde o dinheiro está indo
      expect(s.some((t) => t.includes("Onde o dinheiro está indo"))).toBe(true);
      expect(p.corte!.metaTexto).toContain("Meta do mês");
    });

    it("sem nenhum gasto fixo informado, cai no conselho genérico de assinaturas", () => {
      const p = gerarPlano(
        perfil({ rendaMensal: 1500, moradia: "aluguel", custoMoradia: 1600, gastosFixos: [] }),
      );
      expect(p.modoCorte).toBe(true);
      expect(p.corte!.sugestoes.some((t) => t.includes("assinaturas"))).toBe(true);
      expect(p.corte!.sugestoes.some((t) => t.includes("Onde o dinheiro está indo"))).toBe(false);
    });

    it("nomeia os maiores gastos, do maior pro menor, e quantifica o corte do primeiro", () => {
      const p = gerarPlano(
        perfil({
          rendaMensal: 2000,
          gastosFixos: [
            { categoria: "academia", valor: 150 },
            { categoria: "mercado", valor: 900 },
            { categoria: "streaming", valor: 60 },
            { categoria: "celular", valor: 1000 },
          ],
        }),
      );
      expect(p.modoCorte).toBe(true);
      const s = p.corte!.sugestoes.find((t) => t.includes("Onde o dinheiro está indo"))!;
      // só os 3 maiores: celular 1000, mercado 900, academia 150 — streaming fica de fora
      expect(s).toContain("Celular");
      expect(s).toContain("Mercado");
      expect(s).toContain("Academia");
      expect(s).not.toContain("Streaming");
      expect(s.indexOf("Celular")).toBeLessThan(s.indexOf("Mercado"));
      // um quinto do maior
      expect(s).toContain(formatBRL(200));
    });

    it("gasto de categoria livre entra pelo nome que a pessoa deu", () => {
      const p = gerarPlano(
        perfil({
          rendaMensal: 1000,
          gastosFixos: [{ categoria: "outro", nome: "Mensalidade do clube", valor: 1200 }],
        }),
      );
      expect(p.corte!.sugestoes.some((t) => t.includes("Mensalidade do clube"))).toBe(true);
    });

    it("com dívida cara e aluguel acima de 30% da renda, sugere renegociar (primeiro) e moradia", () => {
      const p = gerarPlano(
        perfil({
          rendaMensal: 2000,
          moradia: "aluguel",
          custoMoradia: 900, // 45%
          gastosFixos: gastos(1200),
          dividas: [{ tipo: "rotativo", saldo: 3000 }],
        }),
      );
      expect(p.modoCorte).toBe(true);
      expect(p.corte!.deficit).toBe(100);
      const s = p.corte!.sugestoes;
      expect(s[0]).toContain("Renegociar");
      expect(s[0]).toContain("rotativo");
      expect(s[1]).toContain("Moradia");
      expect(s[1]).toContain("45%");
      expect(s.some((t) => t.includes("Onde o dinheiro está indo"))).toBe(true);
      expect(p.corte!.metaTexto).toContain("Meta do mês");
    });

    it("aluguel em exatamente 30% da renda não vira sugestão de moradia", () => {
      const p = gerarPlano(
        perfil({ rendaMensal: 2000, moradia: "aluguel", custoMoradia: 600, gastosFixos: gastos(1500) }),
      );
      expect(p.modoCorte).toBe(true);
      expect(p.corte!.sugestoes.some((t) => t.includes("Moradia"))).toBe(false);
    });

    it("dívida média em modo corte não gera sugestão de renegociar", () => {
      const p = gerarPlano(
        perfil({
          rendaMensal: 2000,
          gastosFixos: gastos(1800),
          dividas: [{ tipo: "financiamento", saldo: 20000, parcela: 400 }],
        }),
      );
      expect(p.modoCorte).toBe(true);
      expect(p.dividas.caras).toHaveLength(0);
      expect(p.corte!.sugestoes.some((t) => t.includes("Renegociar"))).toBe(false);
    });
  });

  it("excedente exatamente zero → modo corte", () => {
    const p = gerarPlano(perfil({ rendaMensal: 2000, gastosFixos: gastos(2000) }));
    expect(p.resumo.excedente).toBe(0);
    expect(p.modoCorte).toBe(true);
    expect(p.aporte).toBe(0);
    expect(p.livre).toBe(0);
    expect(p.alocacoes).toEqual([]);
    expect(p.corte!.deficit).toBe(0);
    expect(p.corte!.metaCorte).toBe(2000 * MARGEM_MINIMA_CORTE);
  });

  it("dívida maior que a renda anual com aporte pequeno → mesesParaQuitarCaras null e passo 'Renegociar'", () => {
    const p = gerarPlano(
      perfil({ rendaMensal: 2000, dividas: [{ tipo: "rotativo", saldo: 30000 }], guardado: 1000 }),
    );
    expect(p.degrau).toBe(1);
    expect(p.aporte).toBe(770);
    expect(p.dividas.jurosMensaisCaras).toBeGreaterThan(p.aporte);
    expect(p.dividas.mesesParaQuitarCaras).toBeNull();
    expect(p.proximosPassos.some((t) => t.includes("Renegociar"))).toBe(true);
    esperarInvariantes(p);
  });

  it("duas dívidas caras: ordenadas por taxa e a decisão fala da mais cara", () => {
    const p = gerarPlano(
      perfil({
        dividas: [
          { tipo: "cheque_especial", saldo: 2000 },
          { tipo: "rotativo", saldo: 1000 },
        ],
        guardado: 1000,
      }),
    );
    expect(p.degrau).toBe(1);
    expect(p.dividas.caras.map((d) => d.tipo)).toEqual(["rotativo", "cheque_especial"]);
    expect(p.dividas.caras[0].taxaAnual).toBeGreaterThan(p.dividas.caras[1].taxaAnual);
    expect(p.dividas.totalCaras).toBe(3000);
    expect(p.decisao.titulo).toContain("rotativo");
    expect(p.decisao.titulo).not.toContain("cheque");
    expect(p.alocacoes).toEqual([expect.objectContaining({ destino: "divida_cara", valor: 1120 })]);
    expect(p.alocacoes[0].titulo).toBe("Dívidas caras");
    expect(p.alocacoes[0].descricao).toContain("rotativo");
    expect(p.proximosPassos.some((t) => t.includes("maior taxa primeiro"))).toBe(true);
    esperarInvariantes(p);
  });

  it("só financiamento com reserva completa → degrau 3, alocação divida_media, mesesParaQuitarMedias número", () => {
    const p = gerarPlano(
      perfil({ dividas: [{ tipo: "financiamento", saldo: 15000, parcela: 500 }], guardado: 10000 }),
    );
    expect(p.resumo.custoTotal).toBe(1400);
    expect(p.reserva.ok).toBe(true);
    expect(p.dividas.caras).toHaveLength(0);
    expect(p.dividas.medias).toHaveLength(1);
    expect(p.degrau).toBe(3);
    expect(p.aporte).toBe(440);
    expect(p.livre).toBe(660);
    expect(p.alocacoes).toEqual([expect.objectContaining({ destino: "divida_media", valor: 440 })]);
    expect(typeof p.dividas.mesesParaQuitarMedias).toBe("number");
    expect(p.dividas.mesesParaQuitarMedias!).toBeGreaterThan(0);
    expect(p.dividas.mesesParaQuitarCaras).toBeNull();
    expect(p.decisao.titulo.toLowerCase()).toContain("antecipar");
    esperarInvariantes(p);
  });

  it("financiamento com reserva INcompleta → degrau 2 (reserva vem antes da dívida média)", () => {
    const p = gerarPlano(
      perfil({ dividas: [{ tipo: "financiamento", saldo: 15000, parcela: 500 }], guardado: 2000 }),
    );
    expect(p.folego.ok).toBe(true);
    expect(p.reserva).toMatchObject({ alvo: 4200, atual: 2000, falta: 2200, ok: false });
    expect(p.dividas.medias).toHaveLength(1);
    expect(p.degrau).toBe(2);
    expect(p.aporte).toBe(550);
    expect(p.alocacoes).toEqual([expect.objectContaining({ destino: "reserva", valor: 550 })]);
    expect(destinos(p)).not.toContain("divida_media");
    expect(p.decisao.titulo.toLowerCase()).toContain("reserva");
    esperarInvariantes(p);
  });

  it("dívida com taxaAnual abaixo da taxa livre de risco → barata, não muda o degrau", () => {
    const p = gerarPlano(
      perfil({ dividas: [{ tipo: "outra", saldo: 5000, taxaAnual: 0.05 }], guardado: 10000 }),
    );
    expect(p.dividas.baratas).toHaveLength(1);
    expect(p.dividas.baratas[0].classe).toBe("barata");
    expect(p.dividas.caras).toHaveLength(0);
    expect(p.dividas.medias).toHaveLength(0);
    expect(p.degrau).toBe(4);
    expect(p.alocacoes).toEqual([expect.objectContaining({ destino: "metas" })]);
    esperarInvariantes(p);
  });

  it("taxaAnual informada como 0 é respeitada (não cai no padrão do tipo)", () => {
    const p = gerarPlano(
      perfil({ dividas: [{ tipo: "rotativo", saldo: 500, taxaAnual: 0 }], guardado: 10000 }),
    );
    expect(p.dividas.avaliadas[0].taxaAnual).toBe(0);
    expect(p.dividas.avaliadas[0].classe).toBe("barata");
    expect(p.dividas.avaliadas[0].jurosMensais).toBe(0);
    expect(p.degrau).toBe(4);
  });

  it("custos zero (pais, fixo 0, sem dívida) → fôlego = piso, reserva.alvo ≥ fôlego, nada quebra", () => {
    const p = gerarPlano(perfil({ rendaMensal: 1600, gastosFixos: gastos(0) }));
    expect(p.resumo.custoTotal).toBe(0);
    expect(p.resumo.taxaExcedente).toBe(1);
    expect(p.folego.alvo).toBe(FOLEGO_PISO);
    expect(p.reserva.alvo).toBeGreaterThanOrEqual(p.folego.alvo);
    expect(p.degrau).toBe(0);
    expect(p.aporte).toBe(960);
    expect(p.alocacoes[0]).toMatchObject({ destino: "folego", valor: FOLEGO_PISO });
    // o fôlego já completa a reserva (alvo igual ao piso); o resto vai pra metas
    expect(p.alocacoes[1]).toMatchObject({ destino: "metas", valor: 660 });
    for (const v of [p.aporte, p.livre, p.reserva.alvo, p.reserva.falta, p.folego.falta]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    for (const t of [p.decisao.titulo, p.decisao.texto, ...p.proximosPassos]) {
      expect(t).not.toMatch(/NaN|Infinity|undefined/);
    }
    esperarInvariantes(p);
  });

  it("guardado enorme → folego.atual e reserva.atual limitados ao alvo, degrau 4", () => {
    const p = gerarPlano(perfil({ guardado: 1_000_000 }));
    expect(p.folego.atual).toBe(p.folego.alvo);
    expect(p.folego.falta).toBe(0);
    expect(p.reserva.atual).toBe(p.reserva.alvo);
    expect(p.reserva.falta).toBe(0);
    expect(p.reserva.mesesParaCompletar).toBe(0);
    expect(p.degrau).toBe(4);
    esperarInvariantes(p);
  });

  it("o fôlego alocado no mês conta pra reserva: a alocação de reserva desconta o que foi pro fôlego", () => {
    // custoTotal 300 → fôlego 300, reserva 900 (clt). Aporte 1620 dá pra passar dos dois.
    const p = gerarPlano(perfil({ rendaMensal: 3000, gastosFixos: gastos(300) }));
    expect(p.folego.alvo).toBe(300);
    expect(p.reserva).toMatchObject({ alvo: 900, falta: 900 });
    expect(p.degrau).toBe(0);
    expect(p.aporte).toBe(1620);
    expect(p.alocacoes.map((a) => [a.destino, a.valor])).toEqual([
      ["folego", 300],
      ["reserva", 600], // 900 − 300 que já foi pro fôlego, e não 900
      ["metas", 720],
    ]);
    esperarInvariantes(p);
  });

  describe("reserva.mesesParaCompletar", () => {
    it("0 quando a reserva está ok", () => {
      expect(gerarPlano(perfil({ guardado: 10000 })).reserva.mesesParaCompletar).toBe(0);
    });

    it("número coerente com o aporte quando a reserva recebe aporte (degrau 2)", () => {
      const p = gerarPlano(perfil({ guardado: 1000 }));
      expect(p.degrau).toBe(2);
      expect(p.reserva.falta).toBe(1700);
      expect(p.aporte).toBe(800);
      expect(p.reserva.mesesParaCompletar).toBe(Math.ceil(1700 / 800));
      expect(p.proximosPassos.some((t) => t.includes("fica completa em"))).toBe(true);
    });

    it("com dívida cara na frente, conta o prazo da dívida e depois o da reserva", () => {
      const p = gerarPlano(perfil({ dividas: [{ tipo: "rotativo", saldo: 3000 }], guardado: 1000 }));
      expect(p.degrau).toBe(1);
      expect(p.reserva.ok).toBe(false);
      const quitacao = p.dividas.mesesParaQuitarCaras!;
      expect(quitacao).toBeGreaterThan(0);
      // depois da dívida, a reserva recebe excedente × PROPORCAO_APORTE[2]
      const ritmoReserva = p.resumo.excedente * 0.5;
      expect(p.reserva.mesesParaCompletar).toBe(quitacao + Math.ceil(p.reserva.falta / ritmoReserva));
    });
  });

  it("parcelas informadas entram em custoTotal e reduzem o excedente", () => {
    const sem = gerarPlano(perfil());
    const com = gerarPlano(
      perfil({ dividas: [{ tipo: "financiamento", saldo: 10000, parcela: 400 }] }),
    );
    expect(sem.resumo.parcelas).toBe(0);
    expect(com.resumo.parcelas).toBe(400);
    expect(com.resumo.custoTotal).toBe(sem.resumo.custoTotal + 400);
    expect(com.resumo.excedente).toBe(sem.resumo.excedente - 400);
    // a parcela também sobe o alvo do fôlego e da reserva (custo total inclui parcela)
    expect(com.folego.alvo).toBe(1000);
    expect(com.reserva.alvo).toBe(3 * 1300);
  });

  it("parcela de dívida com saldo zero é ignorada", () => {
    const p = gerarPlano(perfil({ dividas: [{ tipo: "financiamento", saldo: 0, parcela: 400 }] }));
    expect(p.resumo.parcelas).toBe(0);
    expect(p.dividas.avaliadas).toHaveLength(0);
  });

  it("determinismo: duas chamadas com a mesma entrada → toEqual", () => {
    const entrada = perfil({
      rendaMensal: 3100,
      moradia: "dividido",
      custoMoradia: 700,
      gastosFixos: gastos(950),
      dividas: [
        { tipo: "rotativo", saldo: 1200 },
        { tipo: "financiamento", saldo: 9000, parcela: 350 },
      ],
      guardado: 800,
    });
    expect(gerarPlano(entrada)).toEqual(gerarPlano(entrada));
    expect(gerarPlano(entrada)).toEqual(gerarPlano(structuredClone(entrada)));
  });

  it("gerarPlano não muta o perfil de entrada", () => {
    const entrada = perfil({
      dividas: [
        { tipo: "rotativo", saldo: 1000 },
        { tipo: "financiamento", saldo: 5000 },
      ],
    });
    const copia = structuredClone(entrada);
    gerarPlano(entrada);
    expect(entrada).toEqual(copia);
  });

  it("opção taxaLivreRisco muda a classificação: 15% é média com 0.12 e barata com 0.16", () => {
    const entrada = perfil({
      dividas: [{ tipo: "outra", saldo: 5000, taxaAnual: 0.15 }],
      guardado: 10000,
    });
    const media = gerarPlano(entrada, { taxaLivreRisco: 0.12 });
    const barata = gerarPlano(entrada, { taxaLivreRisco: 0.16 });
    expect(media.dividas.avaliadas[0].classe).toBe("media");
    expect(media.degrau).toBe(3);
    expect(media.alocacoes[0].destino).toBe("divida_media");
    expect(barata.dividas.avaliadas[0].classe).toBe("barata");
    expect(barata.degrau).toBe(4);
    expect(barata.alocacoes[0].destino).toBe("metas");
  });
});

describe("cascata — invariantes em lote", () => {
  const cenarios: Perfil[] = [
    perfil({ rendaMensal: 1600, gastosFixos: gastos(600) }),
    perfil({
      rendaMensal: 3000,
      moradia: "aluguel",
      custoMoradia: 1000,
      gastosFixos: gastos(800),
      dividas: [{ tipo: "rotativo", saldo: 4000 }],
      guardado: 1000,
    }),
    perfil({
      rendaMensal: 3000,
      moradia: "aluguel",
      custoMoradia: 1000,
      gastosFixos: gastos(800),
      dividas: [{ tipo: "rotativo", saldo: 1000 }],
      guardado: 500,
    }),
    perfil({ tipoRenda: "pj", guardado: 1000 }),
    perfil({ tipoRenda: "informal" }),
    perfil({ guardado: 10000 }),
    perfil({ rendaMensal: 2000, dividas: [{ tipo: "rotativo", saldo: 30000 }], guardado: 1000 }),
    perfil({
      dividas: [
        { tipo: "cheque_especial", saldo: 2000 },
        { tipo: "rotativo", saldo: 1000 },
      ],
      guardado: 1000,
    }),
    perfil({ dividas: [{ tipo: "financiamento", saldo: 15000, parcela: 500 }], guardado: 10000 }),
    perfil({ dividas: [{ tipo: "financiamento", saldo: 15000, parcela: 500 }], guardado: 2000 }),
    perfil({ dividas: [{ tipo: "outra", saldo: 5000, taxaAnual: 0.05 }], guardado: 10000 }),
    perfil({ rendaMensal: 1600, gastosFixos: gastos(0) }),
    perfil({ guardado: 1_000_000 }),
    perfil({ rendaMensal: 3000, gastosFixos: gastos(300) }),
    perfil({ dividas: [{ tipo: "financiamento", saldo: 10000, parcela: 400 }] }),
    // aperto de verdade: sobra pouco em relação à renda. É onde o piso do
    // acelerado morde — sem cenário assim o piso nunca seria exercitado.
    perfil({ rendaMensal: 3000, moradia: "aluguel", custoMoradia: 1000, gastosFixos: gastos(850) }),
    perfil({
      rendaMensal: 4000,
      moradia: "aluguel",
      custoMoradia: 2000,
      gastosFixos: gastos(1500),
      guardado: 2000,
    }),
    // valores quebrados, pra estressar o arredondamento
    perfil({
      rendaMensal: 2333.33,
      moradia: "aluguel",
      custoMoradia: 777.77,
      gastosFixos: gastos(555.55),
      guardado: 123.45,
    }),
    perfil({
      rendaMensal: 1999.99,
      gastosFixos: gastos(666.67),
      dividas: [{ tipo: "emprestimo", saldo: 1234.56, parcela: 98.76 }],
      guardado: 1000.01,
    }),
    perfil({
      rendaMensal: 4100.1,
      gastosFixos: gastos(1000.03),
      dividas: [{ tipo: "financiamento", saldo: 9999.99, parcela: 333.33 }],
      guardado: 3500.5,
    }),
  ];

  /** gerador determinístico pra cobrir combinações que a lista à mão não cobre */
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }
  const rnd = lcg(42);
  const entre = (a: number, b: number) => Math.round((a + (b - a) * rnd()) * 100) / 100;
  const tipos = ["rotativo", "cheque_especial", "emprestimo", "financiamento", "outra"] as const;
  const tiposRenda = ["clt", "pj", "informal"] as const;
  for (let k = 0; k < 60; k++) {
    const nDividas = Math.floor(rnd() * 4);
    cenarios.push(
      perfil({
        rendaMensal: entre(1200, 8000),
        tipoRenda: tiposRenda[Math.floor(rnd() * 3)],
        moradia: "aluguel",
        custoMoradia: entre(0, 2500),
        // gastos espalhados em categorias diferentes: exercita a soma e a ordenação
        gastosFixos: ["mercado", "academia", "celular", "internet"]
          .map((categoria) => ({ categoria, valor: entre(0, 700) }))
          .filter((g) => g.valor > 0),
        guardado: entre(0, 20000),
        dividas: Array.from({ length: nDividas }, () => ({
          tipo: tipos[Math.floor(rnd() * tipos.length)],
          saldo: entre(100, 30000),
          parcela: rnd() < 0.5 ? entre(0, 600) : undefined,
          taxaAnual: rnd() < 0.3 ? entre(0, 2) : undefined,
        })),
      }),
    );
  }

  it("com excedente > 0: soma das alocações === aporte, aporte + livre === excedente, ordem da cascata", () => {
    let comExcedente = 0;
    // os mesmos cenários pelos três ritmos: o ritmo muda o tamanho do passo,
    // nunca as invariantes
    for (const ritmo of RITMOS) {
      for (const c of cenarios) {
        const p = gerarPlano({ ...c, ritmo });
        expect(p.ritmo).toBe(ritmo);
        if (p.resumo.excedente <= 0) {
          expect(p.modoCorte).toBe(true);
          expect(p.aporte).toBe(0);
          expect(p.livre).toBe(0);
          expect(p.alocacoes).toEqual([]);
          expect(p.piso).toEqual({ sugerido: 0, teto: 0, mordeu: false });
          continue;
        }
        comExcedente++;
        esperarInvariantes(p);
      }
    }
    expect(comExcedente).toBeGreaterThan(60);
  });

  it("o degrau não depende do ritmo: a ordem da cascata é a mesma nos três", () => {
    for (const c of cenarios) {
      const [leve, equilibrado, acelerado] = RITMOS.map((ritmo) => gerarPlano({ ...c, ritmo }));
      expect(leve.degrau).toBe(equilibrado.degrau);
      expect(acelerado.degrau).toBe(equilibrado.degrau);
      expect(leve.modoCorte).toBe(equilibrado.modoCorte);
      expect(acelerado.modoCorte).toBe(equilibrado.modoCorte);
    }
  });

  it("degrau é o primeiro insatisfeito, na ordem fôlego → cara → reserva → média → metas", () => {
    for (const c of cenarios) {
      const p = gerarPlano(c);
      const esperado: Degrau = !p.folego.ok
        ? 0
        : p.dividas.caras.length > 0
          ? 1
          : !p.reserva.ok
            ? 2
            : p.dividas.medias.length > 0
              ? 3
              : 4;
      expect(p.degrau).toBe(esperado);
      // fôlego e reserva nunca passam do alvo
      expect(p.folego.atual).toBeLessThanOrEqual(p.folego.alvo);
      expect(p.reserva.atual).toBeLessThanOrEqual(p.reserva.alvo);
      expect(p.reserva.alvo).toBeGreaterThanOrEqual(p.folego.alvo);
      expect(p.folego.alvo).toBeGreaterThanOrEqual(FOLEGO_PISO);
      expect(p.folego.alvo).toBeLessThanOrEqual(FOLEGO_TETO);
      // dívidas ordenadas da mais cara pra mais barata
      const taxas = p.dividas.avaliadas.map((d) => d.taxaAnual);
      for (let i = 1; i < taxas.length; i++) expect(taxas[i]).toBeLessThanOrEqual(taxas[i - 1]);
    }
  });

  /*
    O ritmo (leve · equilibrado · acelerado) muda só o tamanho do passo. O que
    estes testes protegem: quem não escolhe ritmo continua com o plano de
    sempre, e o acelerado não vira um plano que ninguém consegue seguir.
  */
  describe("ritmo", () => {
    const comExcedente = cenarios.filter((c) => gerarPlano(c).resumo.excedente > 0);

    it("perfil sem ritmo gera exatamente o plano do equilibrado", () => {
      for (const c of cenarios) {
        const semRitmo = gerarPlano(c);
        const equilibrado = gerarPlano({ ...c, ritmo: "equilibrado" });
        expect(semRitmo.ritmo).toBe("equilibrado");
        // só o perfil de entrada difere (um tem o campo ritmo, o outro não)
        expect({ ...semRitmo, perfil: null }).toEqual({ ...equilibrado, perfil: null });
      }
    });

    it("leve e equilibrado nunca são limitados pelo piso: aporte é a tabela, palavra por palavra", () => {
      for (const ritmo of ["leve", "equilibrado"] as const) {
        for (const c of comExcedente) {
          const p = gerarPlano({ ...c, ritmo });
          expect(p.piso.mordeu).toBe(false);
          expect(p.aporte).toBe(emReais(p.resumo.excedente * PROPORCAO_APORTE[ritmo][p.degrau]));
        }
      }
    });

    it("só o acelerado é limitado — e quando é, o plano diz o teto", () => {
      let mordidas = 0;
      for (const c of comExcedente) {
        const p = gerarPlano({ ...c, ritmo: "acelerado" });
        const pedido = emReais(p.resumo.excedente * PROPORCAO_APORTE.acelerado[p.degrau]);
        expect(p.piso.sugerido).toBe(pedido);
        if (!p.piso.mordeu) {
          expect(p.aporte).toBe(pedido);
          continue;
        }
        mordidas++;
        expect(p.aporte).toBe(p.piso.teto);
        expect(p.aporte).toBeLessThan(p.piso.sugerido);
        // o teto respeita a margem mínima da renda (ou o que o equilibrado deixaria livre)
        const livreDoEquilibrado =
          p.resumo.excedente * (1 - PROPORCAO_APORTE.equilibrado[p.degrau]);
        expect(p.livre).toBeGreaterThanOrEqual(
          Math.min(p.resumo.renda * MARGEM_MINIMA_CORTE, livreDoEquilibrado) - 0.01,
        );
      }
      // se ninguém fosse limitado, o piso seria código morto e o teste, decorativo
      expect(mordidas).toBeGreaterThan(0);
    });

    it("o acelerado nunca deixa menos de 10% da renda livre (renda 3.000, aluguel 1.000, fixo 800, rotativo 4.000, guardado 1.000)", () => {
      const cenario: Perfil = perfil({
        rendaMensal: 3000,
        moradia: "aluguel",
        custoMoradia: 1000,
        gastosFixos: gastos(800),
        dividas: [{ tipo: "rotativo", saldo: 4000 }],
        guardado: 1000,
      });
      for (const ritmo of RITMOS) {
        const p = gerarPlano({ ...cenario, ritmo });
        expect(p.resumo.excedente).toBe(1200);
        expect(p.degrau).toBe(1);
        expect(p.livre).toBeGreaterThanOrEqual(p.resumo.renda * MARGEM_MINIMA_CORTE);
      }
      // o mesmo cenário sem o fôlego montado, onde o acelerado pede 0,80 (R$ 960):
      // o piso segura em R$ 900 e sobram exatamente os 10% da renda
      const semFolego = gerarPlano({ ...cenario, guardado: 0, ritmo: "acelerado" });
      expect(semFolego.degrau).toBe(0);
      expect(semFolego.piso.sugerido).toBe(960);
      expect(semFolego.aporte).toBe(900);
      expect(semFolego.livre).toBe(300);
      expect(semFolego.livre).toBe(semFolego.resumo.renda * MARGEM_MINIMA_CORTE);
    });

    it("o piso morde quando o acelerado passaria da margem: R$ 50 a mais de gasto e o teto aparece", () => {
      const p = gerarPlano(
        perfil({
          rendaMensal: 3000,
          moradia: "aluguel",
          custoMoradia: 1000,
          gastosFixos: gastos(850),
          ritmo: "acelerado",
        }),
      );
      expect(p.resumo.excedente).toBe(1150);
      expect(p.degrau).toBe(0);
      expect(p.piso).toEqual({ sugerido: 920, teto: 850, mordeu: true });
      expect(p.aporte).toBe(850);
      expect(p.livre).toBe(300);
      esperarInvariantes(p);
    });

    /** null = "nunca, nesse ritmo": pro prazo, é o pior valor possível */
    const prazos = (p: Plano) =>
      [p.dividas.mesesParaQuitarCaras, p.reserva.mesesParaCompletar, p.dividas.mesesParaQuitarMedias].map(
        (m) => (m === null ? Infinity : m),
      );

    it("monotonicidade: acelerado nunca projeta prazo maior que equilibrado, nem equilibrado maior que leve", () => {
      for (const c of cenarios) {
        const por = (ritmo: Ritmo) => prazos(gerarPlano({ ...c, ritmo }));
        const leve = por("leve");
        const equilibrado = por("equilibrado");
        const acelerado = por("acelerado");
        for (let i = 0; i < leve.length; i++) {
          expect(equilibrado[i]).toBeLessThanOrEqual(leve[i]);
          expect(acelerado[i]).toBeLessThanOrEqual(equilibrado[i]);
        }
      }
    });

    it("o aporte também é monotônico: leve ≤ equilibrado ≤ acelerado", () => {
      for (const c of cenarios) {
        const [leve, equilibrado, acelerado] = RITMOS.map((ritmo) => gerarPlano({ ...c, ritmo }).aporte);
        expect(leve).toBeLessThanOrEqual(equilibrado);
        expect(equilibrado).toBeLessThanOrEqual(acelerado);
      }
    });
  });
});
