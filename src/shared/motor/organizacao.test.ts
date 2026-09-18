/*
  GERADO a partir de dindinFrontend/src/domain/organizacao.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { MAX_GRUPOS, MAX_ITENS_POR_GRUPO, MESES_SIMULACAO_MAX } from "./config";
import { GRUPOS_SUGERIDOS, METAS, metaPorTipo, rotuloMeta } from "./metas-catalogo";
import {
  ajustarProporcionalmente,
  organizarExcedente,
  podeAdicionarGrupo,
  podeAdicionarItem,
  projetarMeta,
  type Grupo,
  type ItemGrupo,
  type Organizacao,
} from "./organizacao";
import { METAS_TIPO } from "./schema";
import type { Meta } from "./types";
import { arredondar } from "./format";

/*
  Organização do excedente e projeção da meta.

  Dois contratos mandam aqui: a soma fecha no centavo (grupos e itens) e a soma
  das porcentagens exibidas dá exatamente 100 — nunca 99, nunca 101. Tudo o que
  entra em conta de dinheiro é verificado no centavo, não "por volta de".

  "hoje" é sempre uma data fixa: 18 de setembro de 2026, o dia em que a v2 foi
  fechada. Data do relógio no teste é teste que quebra sozinho em janeiro.
*/

const HOJE = new Date(2026, 8, 18);

function grupo(p: Partial<Grupo> & { id: string; valor: number }): Grupo {
  return { nome: p.id, icone: "Tag", contaParaMeta: false, itens: [], ...p };
}

function item(id: string, nome: string, valor: number): ItemGrupo {
  return { id, nome, valor };
}

function somaValores(grupos: { valor: number }[]): number {
  return arredondar(grupos.reduce((acc, g) => acc + g.valor, 0));
}

function somaPcts(org: Organizacao): number {
  return org.grupos.reduce((acc, g) => acc + g.pct, 0) + org.sobraPct;
}

/** Todo número da árvore é finito: nada de NaN nem Infinity vazando pra tela. */
function numerosFinitos(org: Organizacao): boolean {
  const numeros = [
    org.base,
    org.totalOrganizado,
    org.sobra,
    org.sobraFatia,
    org.sobraPct,
    org.excesso,
    ...org.grupos.flatMap((g) => [
      g.valor,
      g.fatia,
      g.pct,
      g.restante,
      g.restanteFatia,
      g.restantePct,
      ...g.itens.flatMap((i) => [i.valor, i.fatia, i.pct]),
    ]),
  ];
  return numeros.every((n) => Number.isFinite(n));
}

describe("organizarExcedente — o caso do dono do produto", () => {
  // "sobrou 3000 limpo fora os descontos mensais, ai agora quero organizar:
  //  crio um grupo investimento e coloco um valor, e criar um sub grupo"
  const investimento = grupo({
    id: "g-inv",
    nome: "Investimento",
    icone: "TrendingUp",
    valor: 1500,
    contaParaMeta: true,
  });
  const namoro = grupo({
    id: "g-namoro",
    nome: "Namoro",
    icone: "Heart",
    valor: 600,
    itens: [item("i-presente", "Presente", 200), item("i-ferias", "Férias", 400)],
  });

  const org = organizarExcedente(3000, [investimento, namoro]);

  it("mostra o valor e a porcentagem de cada grupo", () => {
    expect(org.grupos.map((g) => g.valor)).toEqual([1500, 600]);
    expect(org.grupos.map((g) => g.pct)).toEqual([50, 20]);
    expect(org.grupos.map((g) => g.fatia)).toEqual([0.5, 0.2]);
  });

  it("o que não foi para grupo nenhum vira o livre do dia a dia", () => {
    expect(org.totalOrganizado).toBe(2100);
    expect(org.sobra).toBe(900);
    expect(org.sobraPct).toBe(30);
    expect(org.excedeu).toBe(false);
    expect(org.excesso).toBe(0);
  });

  it("os itens do grupo aparecem com a fatia da base", () => {
    const itens = org.grupos[1].itens;
    expect(itens.map((i) => i.valor)).toEqual([200, 400]);
    // 200/3000 = 6,67% e 400/3000 = 13,33%: em pontos inteiros, 7 e 13 — e 7 + 13 = 20, o pct do grupo
    expect(itens.map((i) => i.pct)).toEqual([7, 13]);
    expect(itens[0].fatia).toBeCloseTo(200 / 3000, 10);
  });

  it("itens que fecham o grupo não deixam restante", () => {
    expect(org.grupos[1].restante).toBe(0);
    expect(org.grupos[1].restantePct).toBe(0);
  });

  it("o que o grupo não distribuiu em itens vira o restante do grupo", () => {
    const so = organizarExcedente(3000, [
      grupo({ id: "g", valor: 600, itens: [item("i", "Presente", 200)] }),
    ]);
    expect(so.grupos[0].restante).toBe(400);
    expect(so.grupos[0].itens[0].pct + so.grupos[0].restantePct).toBe(so.grupos[0].pct);
  });

  it("o grupo do sistema entra na lista como qualquer outro", () => {
    const comGuardar = organizarExcedente(3000, [
      grupo({ id: "g-guardar", nome: "Guardar", icone: "PiggyBank", valor: 840, doSistema: true }),
      investimento,
    ]);
    expect(comGuardar.grupos[0].doSistema).toBe(true);
    expect(comGuardar.totalOrganizado).toBe(2340);
    expect(comGuardar.sobra).toBe(660);
    expect(somaPcts(comGuardar)).toBe(100);
  });
});

describe("as porcentagens exibidas somam exatamente 100", () => {
  const cenarios: { rotulo: string; base: number; grupos: Grupo[] }[] = [
    {
      rotulo: "três grupos iguais (o caso do 33 + 33 + 33 = 99)",
      base: 3000,
      grupos: [grupo({ id: "a", valor: 1000 }), grupo({ id: "b", valor: 1000 }), grupo({ id: "c", valor: 1000 })],
    },
    {
      rotulo: "três iguais com sobra",
      base: 3100,
      grupos: [grupo({ id: "a", valor: 1000 }), grupo({ id: "b", valor: 1000 }), grupo({ id: "c", valor: 1000 })],
    },
    {
      rotulo: "sete grupos de um sétimo",
      base: 700,
      grupos: Array.from({ length: 7 }, (_, i) => grupo({ id: `g${i}`, valor: 100 })),
    },
    {
      rotulo: "centavos por toda parte",
      base: 2847.33,
      grupos: [
        grupo({ id: "a", valor: 1234.56, itens: [item("a1", "um", 411.52), item("a2", "dois", 411.52)] }),
        grupo({ id: "b", valor: 99.99 }),
        grupo({ id: "c", valor: 0.01 }),
      ],
    },
    {
      rotulo: "soma acima da base",
      base: 3000,
      grupos: [grupo({ id: "a", valor: 2000 }), grupo({ id: "b", valor: 1500 })],
    },
    {
      rotulo: "um grupo só, valendo a base inteira",
      base: 1200,
      grupos: [grupo({ id: "a", valor: 1200, itens: [item("a1", "um", 1200)] })],
    },
    {
      rotulo: "nenhum grupo: a sobra leva tudo",
      base: 1200,
      grupos: [],
    },
  ];

  for (const { rotulo, base, grupos } of cenarios) {
    it(`fecha 100% — ${rotulo}`, () => {
      const org = organizarExcedente(base, grupos);
      expect(somaPcts(org), rotulo).toBe(100);
      for (const g of org.grupos) {
        const dentro = g.itens.reduce((acc, i) => acc + i.pct, 0) + g.restantePct;
        expect(dentro, `${rotulo} · ${g.nome}`).toBe(g.pct);
      }
      expect(numerosFinitos(org), rotulo).toBe(true);
    });
  }

  it("três grupos iguais dão 34 + 33 + 33, não 33 + 33 + 33", () => {
    const org = organizarExcedente(3000, [
      grupo({ id: "a", valor: 1000 }),
      grupo({ id: "b", valor: 1000 }),
      grupo({ id: "c", valor: 1000 }),
    ]);
    expect(org.grupos.map((g) => g.pct)).toEqual([34, 33, 33]);
    expect(org.sobraPct).toBe(0);
  });
});

describe("soma acima da base", () => {
  const grupos = [grupo({ id: "a", valor: 2000 }), grupo({ id: "b", valor: 1500 })];
  const org = organizarExcedente(3000, grupos);

  it("avisa com o valor exato do que passou, sem cortar nada", () => {
    expect(org.excedeu).toBe(true);
    expect(org.excesso).toBe(500);
    expect(org.sobra).toBe(0);
    expect(org.sobraPct).toBe(0);
    // os valores digitados continuam intactos: a tela avisa, nunca corta enquanto a pessoa digita
    expect(org.grupos.map((g) => g.valor)).toEqual([2000, 1500]);
    expect(somaPcts(org)).toBe(100);
  });

  it("o ajuste proporcional fecha no centavo e apaga o aviso", () => {
    const ajustados = ajustarProporcionalmente(3000, grupos);
    expect(ajustados.map((g) => g.valor)).toEqual([1714.29, 1285.71]);
    expect(somaValores(ajustados)).toBe(3000);

    const depois = organizarExcedente(3000, ajustados);
    expect(depois.excedeu).toBe(false);
    expect(depois.excesso).toBe(0);
    expect(depois.sobra).toBe(0);
    expect(depois.totalOrganizado).toBe(3000);
    expect(somaPcts(depois)).toBe(100);
  });
});

describe("ajustarProporcionalmente — a dízima nos dois níveis", () => {
  // 3.000 entre 1.000/1.000/1.000 e um quarto de 500: a proporção de cada um é
  // 6/7 e 3/7 da base — dízima no grupo E dentro dos itens do primeiro
  const grupos = [
    grupo({ id: "a", valor: 1000, itens: [item("a1", "metade", 500), item("a2", "metade", 500)] }),
    grupo({ id: "b", valor: 1000 }),
    grupo({ id: "c", valor: 1000 }),
    grupo({ id: "d", valor: 500 }),
  ];
  const ajustados = ajustarProporcionalmente(3000, grupos);

  it("a soma dos grupos é a base, no centavo", () => {
    expect(ajustados.map((g) => g.valor)).toEqual([857.15, 857.14, 857.14, 428.57]);
    expect(somaValores(ajustados)).toBe(3000);
  });

  it("os itens fecham o valor do grupo, no centavo", () => {
    // 857,15 dividido em dois: 428,58 e 428,57 — o centavo ímpar vai pro primeiro
    expect(ajustados[0].itens.map((i) => i.valor)).toEqual([428.58, 428.57]);
    expect(somaValores(ajustados[0].itens)).toBe(ajustados[0].valor);
  });

  it("depois do ajuste não sobra nem falta um centavo na base", () => {
    const org = organizarExcedente(3000, ajustados);
    expect(org.totalOrganizado).toBe(3000);
    expect(org.sobra).toBe(0);
    expect(org.excedeu).toBe(false);
    expect(somaPcts(org)).toBe(100);
  });
});

describe("ajustarProporcionalmente — o resto do contrato", () => {
  it("não toca nos grupos que recebeu", () => {
    const grupos = [
      grupo({ id: "a", valor: 2000, itens: [item("a1", "um", 1200)] }),
      grupo({ id: "b", valor: 1500 }),
    ];
    const antes = JSON.stringify(grupos);
    ajustarProporcionalmente(1000, grupos);
    expect(JSON.stringify(grupos)).toBe(antes);
  });

  it("preserva ícone, boolean da meta, rendimento, sistema e os ids", () => {
    const grupos = [
      grupo({
        id: "g-guardar",
        nome: "Guardar",
        icone: "PiggyBank",
        valor: 840,
        doSistema: true,
        rendimentoMensal: 0.008,
      }),
      grupo({ id: "g-inv", nome: "Investimento", icone: "TrendingUp", valor: 1500, contaParaMeta: true }),
    ];
    const ajustados = ajustarProporcionalmente(1000, grupos);
    expect(ajustados[0]).toMatchObject({
      id: "g-guardar",
      nome: "Guardar",
      icone: "PiggyBank",
      doSistema: true,
      rendimentoMensal: 0.008,
      contaParaMeta: false,
    });
    expect(ajustados[1]).toMatchObject({ id: "g-inv", contaParaMeta: true });
  });

  it("o grupo do sistema entra no rateio como os outros", () => {
    const ajustados = ajustarProporcionalmente(900, [
      grupo({ id: "g-guardar", valor: 1000, doSistema: true }),
      grupo({ id: "g-inv", valor: 1000 }),
      grupo({ id: "g-outro", valor: 1000 }),
    ]);
    expect(ajustados.map((g) => g.valor)).toEqual([300, 300, 300]);
  });

  it("o restante do grupo não é engolido pelos itens", () => {
    // grupo de 600 com um item de 200: ao cair pra 300, o item cai junto, na proporção
    const ajustados = ajustarProporcionalmente(300, [
      grupo({ id: "a", valor: 600, itens: [item("a1", "presente", 200)] }),
    ]);
    expect(ajustados[0].valor).toBe(300);
    expect(ajustados[0].itens[0].valor).toBe(100);
  });

  it("grupos todos em zero continuam em zero, sem NaN", () => {
    const ajustados = ajustarProporcionalmente(3000, [
      grupo({ id: "a", valor: 0 }),
      grupo({ id: "b", valor: 0 }),
    ]);
    expect(ajustados.map((g) => g.valor)).toEqual([0, 0]);
  });
});

describe("base zero, negativa ou inválida", () => {
  const grupos = [
    grupo({ id: "a", valor: 500, itens: [item("a1", "um", 200)] }),
    grupo({ id: "b", valor: 300 }),
  ];

  for (const base of [0, -500, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`base ${String(base)}: fatias em zero, nada de NaN ou Infinity`, () => {
      const org = organizarExcedente(base, grupos);
      expect(numerosFinitos(org)).toBe(true);
      expect(org.base).toBe(0);
      expect(org.sobra).toBe(0);
      expect(org.sobraFatia).toBe(0);
      expect(org.sobraPct).toBe(0);
      expect(org.grupos.map((g) => g.fatia)).toEqual([0, 0]);
      expect(org.grupos.map((g) => g.pct)).toEqual([0, 0]);
      expect(org.grupos[0].itens.map((i) => i.pct)).toEqual([0]);
      // em modo corte qualquer grupo já passa da base — a tela troca a seção pelo texto de corte
      expect(org.excedeu).toBe(true);
      expect(org.excesso).toBe(800);
    });
  }

  it("base zero e nenhum grupo não acusa excesso", () => {
    const org = organizarExcedente(0, []);
    expect(org.excedeu).toBe(false);
    expect(org.excesso).toBe(0);
    expect(somaPcts(org)).toBe(0);
  });

  it("ajustar com base zero zera os grupos em vez de estourar", () => {
    const ajustados = ajustarProporcionalmente(-100, grupos);
    expect(ajustados.map((g) => g.valor)).toEqual([0, 0]);
    expect(ajustados[0].itens.map((i) => i.valor)).toEqual([0]);
  });
});

describe("projetarMeta", () => {
  const carro: Meta = { tipo: "carro", valorAlvo: 30000 };

  it("o saldo começa do zero: 10 meses de R$ 1.000 pra uma meta de R$ 10.000", () => {
    const p = projetarMeta({ tipo: "outro", nome: "Notebook", valorAlvo: 10000 }, [grupo({ id: "a", valor: 1000, contaParaMeta: true })], 0, HOJE);
    expect(p.aporteMensal).toBe(1000);
    expect(p.meses).toBe(10);
    expect(p.semRendimento).toBe(10);
  });

  it("só os grupos marcados entram na somatória da meta", () => {
    const p = projetarMeta(
      carro,
      [
        grupo({ id: "g-inv", valor: 1500, contaParaMeta: true }),
        grupo({ id: "g-namoro", valor: 600, itens: [item("i", "Presente", 200)] }),
      ],
      0,
      HOJE,
    );
    expect(p.aporteMensal).toBe(1500);
    expect(p.semRendimento).toBe(20);
    expect(p.mesEstimado).toBe("maio de 2028");
  });

  it("com rendimento chega antes, e a diferença é visível", () => {
    const meta: Meta = { tipo: "liberdade", valorAlvo: 100000 };
    const comJuros = projetarMeta(meta, [grupo({ id: "a", valor: 1000, contaParaMeta: true, rendimentoMensal: 0.01 })], 0, HOJE);
    const semJuros = projetarMeta(meta, [grupo({ id: "a", valor: 1000, contaParaMeta: true })], 0, HOJE);

    expect(semJuros.meses).toBe(100);
    expect(comJuros.meses).toBe(70);
    // o mesmo aporte, o mesmo alvo: 30 meses de diferença só pelo 1% ao mês
    expect(comJuros.meses!).toBeLessThan(semJuros.meses!);
    expect(comJuros.semRendimento).toBe(100);
    expect(comJuros.aporteMensal).toBe(semJuros.aporteMensal);
    expect(comJuros.mesEstimado).toBe("julho de 2032");
  });

  it("cada grupo rende com a sua própria taxa", () => {
    const meta: Meta = { tipo: "casa", valorAlvo: 50000 };
    const misto = projetarMeta(
      meta,
      [
        grupo({ id: "a", valor: 500, contaParaMeta: true, rendimentoMensal: 0.01 }),
        grupo({ id: "b", valor: 500, contaParaMeta: true }),
      ],
      0,
      HOJE,
    );
    const todosRendendo = projetarMeta(
      meta,
      [
        grupo({ id: "a", valor: 500, contaParaMeta: true, rendimentoMensal: 0.01 }),
        grupo({ id: "b", valor: 500, contaParaMeta: true, rendimentoMensal: 0.01 }),
      ],
      0,
      HOJE,
    );
    expect(misto.aporteMensal).toBe(1000);
    expect(todosRendendo.meses!).toBeLessThan(misto.meses!);
    expect(misto.meses!).toBeLessThan(misto.semRendimento!);
  });

  it("o aporte do plano entra só quando o chamador manda", () => {
    const grupos = [grupo({ id: "g-namoro", valor: 600 })];
    const semAporte = projetarMeta({ tipo: "viagem", valorAlvo: 3000 }, grupos, 0, HOJE);
    const comAporte = projetarMeta({ tipo: "viagem", valorAlvo: 3000 }, grupos, 300, HOJE);

    expect(semAporte.aporteMensal).toBe(0);
    expect(semAporte.meses).toBeNull();
    expect(comAporte.aporteMensal).toBe(300);
    expect(comAporte.meses).toBe(10);
    expect(comAporte.mesEstimado).toBe("julho de 2027");
  });

  it("meta inalcançável: nenhum grupo conta e o plano não entra → null", () => {
    const p = projetarMeta(
      carro,
      [grupo({ id: "a", valor: 800 }), grupo({ id: "b", valor: 400, itens: [item("i", "um", 100)] })],
      0,
      HOJE,
    );
    expect(p.aporteMensal).toBe(0);
    expect(p.meses).toBeNull();
    expect(p.semRendimento).toBeNull();
    expect(p.mesEstimado).toBeNull();
    expect(p.valorAlvo).toBe(30000);
  });

  it("grupo marcado mas com valor zero também não leva a meta a lugar nenhum", () => {
    const p = projetarMeta(carro, [grupo({ id: "a", valor: 0, contaParaMeta: true, rendimentoMensal: 0.05 })], 0, HOJE);
    expect(p.meses).toBeNull();
    expect(p.mesEstimado).toBeNull();
  });

  it(`passou de ${MESES_SIMULACAO_MAX} meses, devolve null em vez de uma data em 2140`, () => {
    const p = projetarMeta({ tipo: "casa", valorAlvo: 1_000_000 }, [grupo({ id: "a", valor: 1, contaParaMeta: true })], 0, HOJE);
    expect(p.meses).toBeNull();
    expect(p.semRendimento).toBeNull();
    expect(p.mesEstimado).toBeNull();
  });

  it("rendimento acima do teto é limitado, não projeta ficção", () => {
    const meta: Meta = { tipo: "liberdade", valorAlvo: 100000 };
    const noTeto = projetarMeta(meta, [grupo({ id: "a", valor: 100, contaParaMeta: true, rendimentoMensal: 0.05 })], 0, HOJE);
    // 8 = 800% ao mês, o dedo que errou a vírgula
    const absurdo = projetarMeta(meta, [grupo({ id: "a", valor: 100, contaParaMeta: true, rendimentoMensal: 8 })], 0, HOJE);
    expect(absurdo.meses).toBe(noTeto.meses);
    expect(noTeto.meses).not.toBeNull();
  });

  it("rendimento negativo ou inválido conta como zero", () => {
    const meta: Meta = { tipo: "outro", nome: "Bike", valorAlvo: 5000 };
    const zero = projetarMeta(meta, [grupo({ id: "a", valor: 500, contaParaMeta: true })], 0, HOJE);
    for (const taxa of [-0.02, Number.NaN]) {
      const p = projetarMeta(meta, [grupo({ id: "a", valor: 500, contaParaMeta: true, rendimentoMensal: taxa })], 0, HOJE);
      expect(p.meses, String(taxa)).toBe(zero.meses);
    }
  });

  it("a data vem por parâmetro: a mesma projeção em outro dia dá outro mês", () => {
    const meta: Meta = { tipo: "viagem", valorAlvo: 3000 };
    const grupos = [grupo({ id: "a", valor: 1000, contaParaMeta: true })];
    expect(projetarMeta(meta, grupos, 0, new Date(2026, 8, 18)).mesEstimado).toBe("dezembro de 2026");
    expect(projetarMeta(meta, grupos, 0, new Date(2026, 11, 31)).mesEstimado).toBe("março de 2027");
    // 31 de janeiro + 1 mês não pode virar março
    expect(
      projetarMeta({ tipo: "viagem", valorAlvo: 1000 }, grupos, 0, new Date(2027, 0, 31)).mesEstimado,
    ).toBe("fevereiro de 2027");
  });
});

describe("limites de grupos e itens", () => {
  it(`cabem ${MAX_GRUPOS} grupos, contando o do sistema`, () => {
    const cinco = Array.from({ length: MAX_GRUPOS - 1 }, (_, i) => grupo({ id: `g${i}`, valor: 100 }));
    expect(podeAdicionarGrupo(cinco)).toBe(true);
    expect(podeAdicionarGrupo([...cinco, grupo({ id: "guardar", valor: 840, doSistema: true })])).toBe(false);
  });

  it(`cabem ${MAX_ITENS_POR_GRUPO} itens por grupo`, () => {
    const itens = Array.from({ length: MAX_ITENS_POR_GRUPO - 1 }, (_, i) => item(`i${i}`, `item ${i}`, 10));
    expect(podeAdicionarItem(grupo({ id: "a", valor: 100, itens }))).toBe(true);
    expect(podeAdicionarItem(grupo({ id: "a", valor: 100, itens: [...itens, item("x", "x", 10)] }))).toBe(false);
  });

  it("passar do limite não quebra a conta: o rateio continua fechando 100%", () => {
    const demais = Array.from({ length: MAX_GRUPOS + 3 }, (_, i) => grupo({ id: `g${i}`, valor: 137.77 }));
    const org = organizarExcedente(2000, demais);
    expect(somaPcts(org)).toBe(100);
    expect(numerosFinitos(org)).toBe(true);
  });
});

describe("catálogo de metas e grupos sugeridos", () => {
  it("todo MetaTipo tem cartão, com nome e ícone", () => {
    expect(METAS.map((m) => m.slug)).toEqual([...METAS_TIPO]);
    for (const m of METAS) {
      expect(m.nome.length, m.slug).toBeGreaterThan(0);
      expect(m.icone.length, m.slug).toBeGreaterThan(0);
    }
  });

  it("tipo desconhecido cai em Outro em vez de derrubar a tela", () => {
    expect(metaPorTipo("carro").icone).toBe("Car");
    expect(metaPorTipo("inexistente" as never).slug).toBe("outro");
  });

  it("o rótulo é o nome que a pessoa deu, ou o do catálogo", () => {
    expect(rotuloMeta({ tipo: "carro", valorAlvo: 30000 })).toBe("Carro");
    expect(rotuloMeta({ tipo: "outro", nome: "Notebook novo", valorAlvo: 4000 })).toBe("Notebook novo");
    expect(rotuloMeta({ tipo: "outro", nome: "   ", valorAlvo: 4000 })).toBe("Outro");
  });

  it("existe um grupo do sistema só, e Investimento e Emergência já contam pra meta", () => {
    expect(GRUPOS_SUGERIDOS.filter((g) => g.doSistema)).toHaveLength(1);
    const contam = GRUPOS_SUGERIDOS.filter((g) => g.contaParaMeta).map((g) => g.slug);
    expect(contam).toEqual(["investimento", "emergencia"]);
  });

  it("nenhum slug repetido", () => {
    const slugs = GRUPOS_SUGERIDOS.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
