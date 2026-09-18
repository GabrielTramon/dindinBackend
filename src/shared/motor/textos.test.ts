/*
  GERADO a partir de dindinFrontend/src/domain/textos.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { formatBRL, formatMeses } from "./format";
import { MESES_SIMULACAO_MAX } from "./config";
import { gerarPlano } from "./motor";
import { RITMOS } from "./schema";
import { NOME_DIVIDA, ROTULO_DEGRAU, ROTULO_DIVIDA, ROTULO_RITMO, textos } from "./textos";
import type { Degrau, Perfil, Plano } from "./types";
/** Açúcar dos testes: um gasto fixo único, pra cenários que só olham o total. */
const gastos = (valor: number) => (valor > 0 ? [{ categoria: "mercado", valor }] : []);


/*
  Tudo que o plano diz em palavras. Dois limites do produto:
    - a decisão de cada degrau usa a palavra certa (fôlego / quitar / reserva / antecipar / meta);
    - nenhuma frase cita banco, corretora, emissor ou produto. Só classe de ativo.
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

/** um perfil por degrau, mais dois de corte */
const porDegrau: Record<Degrau, Perfil> = {
  0: perfil(),
  1: perfil({ dividas: [{ tipo: "rotativo", saldo: 2000 }], guardado: 1000 }),
  2: perfil({ guardado: 1000 }),
  3: perfil({ dividas: [{ tipo: "financiamento", saldo: 15000, parcela: 500 }], guardado: 10000 }),
  4: perfil({ guardado: 10000 }),
};
const corte = {
  simples: perfil({ rendaMensal: 1500, gastosFixos: gastos(1700) }),
  completo: perfil({
    rendaMensal: 2000,
    moradia: "aluguel",
    custoMoradia: 900,
    gastosFixos: gastos(1200),
    dividas: [
      { tipo: "rotativo", saldo: 3000 },
      { tipo: "cheque_especial", saldo: 500 },
    ],
  }),
};
const extras = [
  perfil({ rendaMensal: 1600, gastosFixos: gastos(0) }),
  perfil({ rendaMensal: 2000, dividas: [{ tipo: "rotativo", saldo: 30000 }], guardado: 1000 }),
  perfil({
    rendaMensal: 3000,
    moradia: "aluguel",
    custoMoradia: 1000,
    gastosFixos: gastos(800),
    dividas: [
      { tipo: "rotativo", saldo: 1000 },
      { tipo: "emprestimo", saldo: 3000, parcela: 200 },
    ],
    guardado: 500,
  }),
  perfil({ tipoRenda: "pj", guardado: 1000 }),
  perfil({ tipoRenda: "informal", dividas: [{ tipo: "outra", saldo: 800 }] }),
  perfil({ dividas: [{ tipo: "financiamento", saldo: 15000, parcela: 500 }], guardado: 2000 }),
];
/** todo cenário pelos três ritmos: o ritmo muda frases, não só números */
const todos: Perfil[] = RITMOS.flatMap((ritmo) =>
  [...Object.values(porDegrau), ...Object.values(corte), ...extras].map((p) => ({ ...p, ritmo })),
);

function frases(p: Plano): string[] {
  return [
    p.decisao.titulo,
    p.decisao.texto,
    ...p.alocacoes.flatMap((a) => [a.titulo, a.descricao]),
    ...p.proximosPassos,
    ...(p.corte?.sugestoes ?? []),
  ];
}

describe("decisão por degrau", () => {
  it.each([
    [0, "fôlego"],
    [1, "quitar"],
    [2, "reserva"],
    [3, "antecipar"],
    [4, "meta"],
  ] as const)("degrau %i → título contém '%s'", (degrau, palavra) => {
    const p = gerarPlano(porDegrau[degrau]);
    expect(p.degrau).toBe(degrau);
    expect(p.modoCorte).toBe(false);
    expect(p.decisao.titulo.toLowerCase()).toContain(palavra);
    expect(p.decisao.texto.length).toBeGreaterThan(20);
  });

  it("degrau 1 nomeia a dívida mais cara e o custo mensal em juros", () => {
    const p = gerarPlano(porDegrau[1]);
    expect(p.decisao.titulo).toContain(NOME_DIVIDA.rotativo);
    expect(p.decisao.texto).toContain("por mês");
    expect(p.decisao.texto).toContain("ao ano");
  });

  it("degrau 2 explica o multiplicador pelo tipo de renda", () => {
    expect(gerarPlano(porDegrau[2]).decisao.texto).toContain("renda é fixa");
    expect(gerarPlano(porDegrau[2]).decisao.texto).toContain("3 meses");
    const pj = gerarPlano(perfil({ tipoRenda: "pj", guardado: 1000 }));
    expect(pj.decisao.texto).toContain("renda é variável");
    expect(pj.decisao.texto).toContain("6 meses");
  });

  it("modo corte tem título de corte e não fala em aporte", () => {
    const p = gerarPlano(corte.simples);
    expect(p.modoCorte).toBe(true);
    expect(p.decisao.titulo).toContain("caber na sua renda");
    expect(p.decisao.texto).toContain("corte");
    expect(p.decisao.texto).toContain(formatBRL(200)); // formatBRL usa espaço não separável
  });
});

describe("nenhum texto cita banco, corretora ou produto", () => {
  const proibidos = /\b(Nubank|Ita[uú]|Bradesco|XP|Tesouro|CDB|LCI|LCA|Bitcoin|Caixa Econ[oô]mica|Santander|Inter|C6|PicPay|Selic)\b/i;

  it("em todos os cenários", () => {
    let contadas = 0;
    for (const perfilCenario of todos) {
      for (const frase of frases(gerarPlano(perfilCenario))) {
        contadas++;
        expect(frase, frase).not.toMatch(proibidos);
      }
    }
    expect(contadas).toBeGreaterThan(50);
  });

  it("nem os rótulos fixos", () => {
    for (const t of [...Object.values(NOME_DIVIDA), ...Object.values(ROTULO_DIVIDA), ...Object.values(ROTULO_DEGRAU)]) {
      expect(t).not.toMatch(proibidos);
    }
  });
});

describe("proximosPassos", () => {
  const ultimaFrase = "Volte no mês que vem e refaça as respostas com o que mudou: o plano se recalcula na hora.";

  it("fora do modo corte, sempre termina com a frase do mês que vem", () => {
    for (const perfilCenario of todos) {
      const p = gerarPlano(perfilCenario);
      if (p.modoCorte) continue;
      expect(p.proximosPassos.at(-1)).toBe(ultimaFrase);
      expect(p.proximosPassos.filter((t) => t === ultimaFrase)).toHaveLength(1);
    }
  });

  it("fora do modo corte, o primeiro passo separa aporte e livre", () => {
    for (const degrau of [0, 1, 2, 3, 4] as const) {
      const p = gerarPlano(porDegrau[degrau]);
      expect(p.proximosPassos[0]).toContain("Separe");
      expect(p.proximosPassos[0]).toContain("sem culpa");
    }
  });

  it("em modo corte não repete as sugestões: diz o que fazer com a lista e quando refazer", () => {
    for (const perfilCenario of Object.values(corte)) {
      const p = gerarPlano(perfilCenario);
      expect(p.modoCorte).toBe(true);
      expect(p.corte!.sugestoes.length).toBeGreaterThanOrEqual(2);
      expect(p.proximosPassos).toHaveLength(2);
      for (const s of p.corte!.sugestoes) expect(p.proximosPassos).not.toContain(s);
      expect(p.proximosPassos[0]).toContain("lista de corte");
      // fecha pedindo pra refazer o plano quando fechar no azul
      expect(p.proximosPassos.at(-1)).toContain("refaça o plano");
    }
  });

  it("em modo corte com dívida cara e moradia pesada: renegociar → moradia → assinaturas → renda; a meta fica à parte", () => {
    const c = gerarPlano(corte.completo).corte!;
    expect(c.sugestoes).toHaveLength(4);
    expect(c.sugestoes[0]).toMatch(/^Renegociar o rotativo/);
    expect(c.sugestoes[1]).toMatch(/^Moradia leva 45%/);
    expect(c.sugestoes[2]).toContain("Onde o dinheiro está indo");
    expect(c.sugestoes[3]).toMatch(/^Pelo lado da renda/);
    expect(c.metaTexto).toMatch(/^Meta do mês/);
  });

  it("degrau 0 orienta a conta separada do fôlego", () => {
    expect(gerarPlano(porDegrau[0]).proximosPassos.some((t) => t.includes("conta separada"))).toBe(true);
    expect(gerarPlano(porDegrau[2]).proximosPassos.some((t) => t.includes("conta separada"))).toBe(false);
  });

  it("degrau 1 diz em quantos meses as caras zeram, ou manda renegociar", () => {
    expect(gerarPlano(porDegrau[1]).proximosPassos.some((t) => t.includes("zeram em"))).toBe(true);
    const nunca = gerarPlano(perfil({ rendaMensal: 2000, dividas: [{ tipo: "rotativo", saldo: 30000 }], guardado: 1000 }));
    expect(nunca.proximosPassos.some((t) => t.includes("Renegociar"))).toBe(true);
    expect(nunca.proximosPassos.some((t) => t.includes("zeram em"))).toBe(false);
  });

  /*
    "é o único caminho" é uma afirmação forte: só pode sair quando nenhum dos
    três ritmos zera a dívida. Com o cartão de ritmo ao lado, dizer isso quando
    o equilibrado resolve é mentir pra quem está no aperto.
  */
  describe("dívida cara sem prazo", () => {
    /** medido: no leve essa dívida nunca zera; no equilibrado zera em 3 anos */
    const apertado = perfil({
      rendaMensal: 3194.76,
      gastosFixos: gastos(1181.38),
      dividas: [{ tipo: "emprestimo", saldo: 21901.62, taxaAnual: 0.9 }],
      guardado: 1000,
    });

    it("no leve não quita, mas o texto não diz 'único caminho' — diz o prazo do ritmo que resolve", () => {
      const leve = gerarPlano({ ...apertado, ritmo: "leve" });
      const equilibrado = gerarPlano({ ...apertado, ritmo: "equilibrado" });
      expect(leve.dividas.mesesParaQuitarCaras).toBeNull();
      expect(equilibrado.dividas.mesesParaQuitarCaras).not.toBeNull();

      const aviso = leve.proximosPassos.find((t) => t.includes("Neste ritmo"))!;
      expect(aviso).toBeDefined();
      expect(aviso).toContain(ROTULO_RITMO.equilibrado);
      expect(aviso).toContain(formatMeses(equilibrado.dividas.mesesParaQuitarCaras!));
      expect(aviso).toContain(NOME_DIVIDA.emprestimo);
      expect(aviso).toBe(
        "Neste ritmo, os juros crescem mais rápido do que você paga. No ritmo equilibrado — que guarda uma fatia maior do que sobra — o empréstimo zera em 3 anos.",
      );
      for (const t of leve.proximosPassos) {
        expect(t).not.toContain("único caminho");
        expect(t).not.toContain("não é opcional");
      }
    });

    it("no equilibrado o prazo aparece normalmente, sem aviso", () => {
      const p = gerarPlano({ ...apertado, ritmo: "equilibrado" });
      expect(p.proximosPassos.some((t) => t.includes("zeram em"))).toBe(true);
      expect(p.proximosPassos.some((t) => t.includes("Neste ritmo"))).toBe(false);
    });

    it("quando nenhum dos três quita, a frase forte volta — nos três ritmos", () => {
      const semSaida = perfil({
        rendaMensal: 2000,
        dividas: [{ tipo: "rotativo", saldo: 30000 }],
        guardado: 1000,
      });
      for (const ritmo of RITMOS) {
        const p = gerarPlano({ ...semSaida, ritmo });
        expect(p.diagnosticoCaras).toMatchObject({ ritmoQueResolve: null });
        expect(p.proximosPassos.some((t) => t.includes("é o único caminho"))).toBe(true);
        expect(p.proximosPassos.some((t) => t.includes("Renegociar"))).toBe(true);
      }
    });

    it("travar no horizonte não vira 'os juros crescem mais rápido do que você paga'", () => {
      // o mesmo plano, com a causa trocada: é o único jeito de exercitar a
      // frase do horizonte sem uma dívida cara que leve 50 anos pra cair
      const p = gerarPlano({
        ...perfil({ rendaMensal: 2000, dividas: [{ tipo: "rotativo", saldo: 30000 }], guardado: 1000 }),
      });
      const passos = textos.proximosPassos({
        perfil: p.perfil,
        resumo: p.resumo,
        degrau: p.degrau,
        ritmo: p.ritmo,
        folego: p.folego,
        reserva: p.reserva,
        dividas: p.dividas,
        diagnosticoCaras: { ...p.diagnosticoCaras!, motivo: "horizonte" },
        corte: p.corte,
        aporte: p.aporte,
        livre: p.livre,
      });
      const aviso = passos.find((t) => t.includes("é o único caminho"))!;
      expect(aviso).toContain(formatMeses(MESES_SIMULACAO_MAX));
      expect(aviso).not.toContain("crescem mais rápido");
    });
  });

  it("degrau 3 diz quando a dívida média termina; degrau 4 pede pra separar o aporte pra um objetivo, sem prometer cálculo que ainda não existe", () => {
    expect(gerarPlano(porDegrau[3]).proximosPassos.some((t) => t.includes("termina em"))).toBe(true);
    const passoMeta = gerarPlano(porDegrau[4]).proximosPassos.find((t) => t.includes("objetivo seu"));
    expect(passoMeta).toContain("Em breve");
  });
});

describe("alocações", () => {
  it("cada alocação tem título e descrição não vazios", () => {
    for (const perfilCenario of todos) {
      for (const a of gerarPlano(perfilCenario).alocacoes) {
        expect(a.titulo.trim().length).toBeGreaterThan(0);
        expect(a.descricao.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("uma dívida cara usa o rótulo dela; duas usam 'Dívidas caras'", () => {
    const uma = gerarPlano(porDegrau[1]).alocacoes[0];
    expect(uma.titulo).toBe(ROTULO_DIVIDA.rotativo);
    expect(uma.descricao).toContain("Vai inteiro");
    const duas = gerarPlano(
      perfil({ dividas: [{ tipo: "rotativo", saldo: 1000 }, { tipo: "cheque_especial", saldo: 1000 }], guardado: 1000 }),
    ).alocacoes[0];
    expect(duas.titulo).toBe("Dívidas caras");
    expect(duas.descricao).toContain(NOME_DIVIDA.rotativo);
  });

  it("nenhum texto tem NaN, undefined ou Infinity", () => {
    for (const perfilCenario of todos) {
      for (const frase of frases(gerarPlano(perfilCenario))) {
        expect(frase).not.toMatch(/NaN|undefined|Infinity|null/);
      }
    }
  });
});
