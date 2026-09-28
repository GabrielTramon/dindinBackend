/*
  GERADO a partir de dindinFrontend/src/domain/resposta.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { simularRitmos } from "./divisor";
import { gerarPlano } from "./motor";
import { projetarMeta } from "./organizacao";
import {
  NOME_CURTO_DIVIDA,
  respostaDoPlano,
  textosDivisor,
  textosPote,
  type Resposta,
  type RespostaCorte,
  type RespostaPlano,
} from "./resposta";
import type { Perfil } from "./types";
import { formatBRL, formatMeses } from "./format";

/*
  O cartão-resposta: objetivo em palavras, quanto por mês (e a % do que sobra),
  por quanto tempo e o que fica livre. Os números vêm do motor de verdade.
*/

const HOJE = new Date(2026, 8, 24); // setembro de 2026

const PERFIL_A: Perfil = {
  rendaMensal: 2800,
  tipoRenda: "clt",
  idade: 24,
  moradia: "dividido",
  custoMoradia: 700,
  gastosFixos: [
    { categoria: "mercado", valor: 450 },
    { categoria: "transporte_publico", valor: 200 },
    { categoria: "celular", valor: 90 },
    { categoria: "academia", valor: 120 },
    { categoria: "streaming", valor: 40 },
  ],
  dividas: [{ tipo: "rotativo", saldo: 1500 }],
  guardado: 1000,
  meta: { tipo: "viagem", valorAlvo: 6000 },
};

const PERFIL_PRINT: Perfil = {
  rendaMensal: 1500,
  tipoRenda: "clt",
  idade: 24,
  moradia: "pais",
  custoMoradia: 0,
  gastosFixos: [
    { categoria: "celular", valor: 77 },
    { categoria: "academia", valor: 100 },
  ],
  dividas: [],
  guardado: 500,
};

/** renda 2.000, contas 1.000, rotativo de 5.000: só o acelerado vence os juros */
const SO_ACELERADO: Perfil = {
  rendaMensal: 2000,
  tipoRenda: "clt",
  idade: 24,
  moradia: "aluguel",
  custoMoradia: 1000,
  gastosFixos: [],
  dividas: [{ tipo: "rotativo", saldo: 5000 }],
  guardado: 1000,
};

function resposta(perfil: Perfil): Resposta {
  const plano = gerarPlano(perfil);
  return respostaDoPlano(plano, { simulacoes: simularRitmos(perfil), hoje: HOJE });
}

function doPlano(perfil: Perfil): RespostaPlano {
  const r = resposta(perfil);
  if (r.modo !== "plano") throw new Error("esperava um plano, veio corte");
  return r;
}

function deCorte(perfil: Perfil): RespostaCorte {
  const r = resposta(perfil);
  if (r.modo !== "corte") throw new Error("esperava corte");
  return r;
}

describe("respostaDoPlano — perfil A", () => {
  it("equilibrado: quitar o cartão, R$ 840 (70%) por 3 meses", () => {
    const r = doPlano(PERFIL_A);
    expect(r.eyebrow).toBe("Seu plano · setembro de 2026");
    expect(r.objetivo).toBe("Quitar o cartão");
    expect(r.valorMes).toBe(840);
    expect(r.pct).toBe(70);
    expect(r.pctTexto).toBe("70% do que sobra");
    expect(r.tempo).toEqual({
      tipo: "prazo",
      meses: 3,
      mes: "dezembro de 2026",
      texto: "por 3 meses · até dezembro de 2026",
      rotuloSr: "Até o cartão zerar: 3 meses, até dezembro de 2026",
    });
    expect(r.livre).toBe(360);
    expect(r.fecho).toBe(`Os outros ${formatBRL(360)} são seus, sem culpa.`);
    expect(r.esteMes).toBe("cartão");
    expect(r.acaoSugerida).toBeUndefined();
  });

  it("ritmo: Leve 50% · Equilibrado 70% · Acelerado 77%, com o equilibrado marcado", () => {
    const r = doPlano(PERFIL_A);
    expect(r.segmentos.map((s) => [s.nome, s.pct, s.valor])).toEqual([
      ["Leve", 50, 600],
      ["Equilibrado", 70, 840],
      ["Acelerado", 77, 920],
    ]);
    expect(r.segmentos[1].descricaoSr).toBe(`${formatBRL(840)} por mês; o cartão zera em 3 meses`);
    expect(r.segmentos[0].descricaoSr).toBe(`${formatBRL(600)} por mês; o cartão zera em 4 meses`);
    expect(r.ritmoMarcado).toBe("equilibrado");
    expect(r.linhaRitmo).toBeUndefined();
    expect(r.anuncio).toBe(`Equilibrado: separe ${formatBRL(840)} por mês, 70% do que sobra. O cartão zera em 3 meses.`);
  });

  it("acelerado segurado pelo piso: a linha explica o 77% e diz que à mão dá pra ir além", () => {
    const r = doPlano({ ...PERFIL_A, ritmo: "acelerado" });
    expect(r.valorMes).toBe(920);
    expect(r.ritmoMarcado).toBe("acelerado");
    expect(r.linhaRitmo).toBe(
      `O Acelerado sugere até 77% pra deixar ${formatBRL(280)} livres. Quer guardar mais? Suba a % do Guardar.`,
    );
  });

  it("o valor total a alcançar: o total da dívida cara", () => {
    const r = doPlano(PERFIL_A);
    expect(r.alvo).toEqual({ rotulo: "Total", valor: 1500, rotuloSr: `Total: ${formatBRL(1500)}` });
  });

  it("personalizado: nenhum ritmo marcado e a % escolhida à mão", () => {
    const r = doPlano({ ...PERFIL_A, aporteEscolhido: 720 });
    expect(r.ritmoMarcado).toBeNull();
    expect(r.pct).toBe(60);
    expect(r.linhaRitmo).toBe("Você escolheu 60% à mão. Toque num ritmo pra voltar ao sugerido.");
    // as % dos ritmos continuam as deles, sem a escolha manual
    expect(r.segmentos.map((s) => s.pct)).toEqual([50, 70, 77]);
  });

  it("Guardar em 0%: parado", () => {
    const r = doPlano({ ...PERFIL_A, aporteEscolhido: 0 });
    expect(r.tempo).toMatchObject({
      tipo: "parado",
      texto: "Parado",
      frase: "Guardando 0%, o plano não anda. Escolha um ritmo pra voltar a andar.",
    });
    expect(r.valorMes).toBe(0);
  });
});

describe("respostaDoPlano — perfil do print", () => {
  it("reserva: R$ 661 (50%) e R$ 662 livres, fechando R$ 1.323", () => {
    const r = doPlano(PERFIL_PRINT);
    expect(r.objetivo).toBe("Completar sua reserva");
    expect(r.valorMes + r.livre).toBe(1323);
    expect(r.pct).toBe(50);
    expect(r.tempo).toMatchObject({ tipo: "prazo", meses: 1, mes: "outubro de 2026" });
    expect(r.segmentos.map((s) => s.pct)).toEqual([35, 50, 70]);
    expect(r.esteMes).toBe("reserva e metas");
  });

  it("degrau 0: montar seu fôlego, com o rótulo do fôlego e da reserva juntos", () => {
    const r = doPlano({ ...PERFIL_PRINT, guardado: 0 });
    expect(r.objetivo).toBe("Montar seu fôlego");
    expect(r.tempo).toMatchObject({ tipo: "prazo", meses: 1 });
    if (r.tempo.tipo !== "prazo") throw new Error("sem prazo");
    expect(r.tempo.rotuloSr).toBe("Até o fôlego e a reserva ficarem prontos: 1 mês, até outubro de 2026");
    expect(r.esteMes).toBe("fôlego, reserva e metas");
  });

  it("o que fica livre e o que se guarda sempre fecham a sobra, mesmo com o Guardar editado", () => {
    const r = doPlano({ ...PERFIL_PRINT, aporteEscolhido: 1323 });
    expect(r.valorMes + r.livre).toBe(1323);
    // à mão vale 100%: nada livre, por escolha dela — e a frase não julga
    expect(r.valorMes).toBe(1323);
    expect(r.livre).toBe(0);
    expect(r.pct).toBe(100);
    expect(r.fecho).toBe("Tudo o que sobra vai pros seus potes este mês.");
  });

  it("o valor total a alcançar antes da meta: fôlego ou reserva, com o que falta", () => {
    const plano = gerarPlano(PERFIL_PRINT);
    const r = doPlano(PERFIL_PRINT);
    const esperado = plano.degrau === 0 ? plano.folego : plano.reserva;
    expect(r.alvo?.rotulo).toBe(plano.degrau === 0 ? "Fôlego" : "Reserva");
    expect(r.alvo?.valor).toBe(esperado.alvo);
    if (esperado.falta > 0 && esperado.falta < esperado.alvo) {
      expect(r.alvo?.detalhe).toBe(`faltam ${formatBRL(esperado.falta)}`);
    }
  });
});

describe("respostaDoPlano — degrau 4", () => {
  const RESOLVIDO: Perfil = { ...PERFIL_A, dividas: [], guardado: 10000 };

  it("com meta: juntar pra Viagem em 17 meses (fevereiro de 2028)", () => {
    const r = doPlano(RESOLVIDO);
    expect(r.objetivo).toBe("Juntar pra Viagem");
    expect(r.valorMes).toBe(360);
    expect(r.tempo).toMatchObject({ tipo: "prazo", meses: 17, mes: "fevereiro de 2028" });
    expect(r.fecho).toBe(`Os outros ${formatBRL(840)} são seus, sem culpa.`);
  });

  it("o valor total a alcançar é o da meta", () => {
    const r = doPlano(RESOLVIDO);
    expect(r.alvo).toEqual({ rotulo: "Meta", valor: 6000, rotuloSr: `Meta: ${formatBRL(6000)}` });
  });

  it("sem meta, não há valor total pra mostrar", () => {
    const semMeta = { ...RESOLVIDO };
    delete semMeta.meta;
    expect(doPlano(semMeta).alvo).toBeUndefined();
  });

  it("o rendimento do Guardar adianta a meta — e o cartão diz quantos meses", () => {
    const plano = gerarPlano(RESOLVIDO);
    const guardar = {
      id: "guardar",
      nome: "Guardar",
      icone: "PiggyBank",
      valor: plano.aporte,
      contaParaMeta: true,
      doSistema: true,
      rendimentoMensal: 0.01,
      itens: [],
    };
    const projecaoMeta = projetarMeta({ tipo: "viagem", valorAlvo: 6000 }, [guardar], 0, HOJE);
    expect(projecaoMeta.semRendimento).toBe(17);
    const r = respostaDoPlano(plano, {
      projecaoMeta,
      simulacoes: simularRitmos(RESOLVIDO),
      grupos: [guardar],
      hoje: HOJE,
    });
    if (r.modo !== "plano" || r.tempo.tipo !== "prazo") throw new Error("esperava prazo");
    expect(r.tempo.meses).toBeLessThan(17);
    expect(r.rendimentoAdianta).toBe(17 - r.tempo.meses);
    // os ritmos projetam com o mesmo rendimento do Guardar
    expect(r.segmentos.find((s) => s.ritmo === "equilibrado")?.descricaoSr).toContain(`em ${formatMeses(r.tempo.meses)}`);
  });

  it("sem rendimento, nada de 'chega antes'", () => {
    expect(doPlano(RESOLVIDO).rendimentoAdianta).toBeUndefined();
  });

  it("usa a projeção da meta que a tela passa (com os potes)", () => {
    const plano = gerarPlano(RESOLVIDO);
    const projecaoMeta = projetarMeta(
      { tipo: "viagem", valorAlvo: 6000 },
      [{ id: "inv", nome: "Investimento", icone: "TrendingUp", valor: 240, contaParaMeta: true, itens: [] }],
      plano.aporte,
      HOJE,
    );
    const r = respostaDoPlano(plano, { projecaoMeta, simulacoes: simularRitmos(RESOLVIDO), hoje: HOJE });
    expect(r.modo === "plano" && r.tempo).toMatchObject({ tipo: "prazo", meses: 10 });
  });

  it("sem meta: em 1 ano, R$ 4.320 guardados", () => {
    const semMeta = { ...RESOLVIDO };
    delete semMeta.meta;
    const r = doPlano(semMeta);
    expect(r.objetivo).toBe("Guardar pro que você quiser");
    expect(r.tempo).toEqual({
      tipo: "ano",
      valor: 4320,
      texto: `em 1 ano, ${formatBRL(4320)} guardados`,
      rotuloSr: `Em 1 ano: ${formatBRL(4320)} guardados pro que você quiser`,
    });
  });

  it("meta que não fecha em 50 anos: 'Não fecha nesse ritmo'", () => {
    const r = doPlano({ ...RESOLVIDO, meta: { tipo: "casa", valorAlvo: 100_000_000 } });
    expect(r.tempo).toMatchObject({
      tipo: "sem-prazo",
      texto: "Não fecha nesse ritmo",
      frase: `Com ${formatBRL(360)} por mês, a meta Casa não fecha nem em 50 anos. Guarde uma fatia maior ou reveja o valor dela.`,
    });
  });
});

describe("respostaDoPlano — dívida cara sem prazo", () => {
  it("outro ritmo resolve: 'Não zera nesse ritmo' + botão 'Usar o Acelerado'", () => {
    const plano = gerarPlano(SO_ACELERADO);
    expect(plano.diagnosticoCaras?.ritmoQueResolve).toBe("acelerado");
    const r = doPlano(SO_ACELERADO);
    expect(r.tempo.tipo).toBe("sem-prazo");
    expect(r.tempo.texto).toBe("Não zera nesse ritmo");
    if (r.tempo.tipo !== "sem-prazo") throw new Error("tinha prazo");
    const meses = plano.diagnosticoCaras?.mesesNoRitmoQueResolve ?? 0;
    expect(r.tempo.frase).toMatch(
      /^Neste ritmo, os juros crescem mais rápido do que você paga\. No ritmo acelerado — que guarda uma fatia maior do que sobra — o rotativo do cartão zera em /,
    );
    expect(r.tempo.frase).toContain(meses >= 12 ? "ano" : "mes");
    // a mesma frase dos próximos passos: o cartão e os detalhes não se contradizem
    expect(plano.proximosPassos).toContain(r.tempo.frase);
    expect(r.tempo.verDetalhes).toBeUndefined();
    expect(r.acaoSugerida).toEqual({ ritmo: "acelerado", rotulo: "Usar o Acelerado" });
  });

  it("nenhum ritmo resolve: renegociar, com o link pros detalhes", () => {
    const r = doPlano({ ...SO_ACELERADO, custoMoradia: 1700 });
    if (r.tempo.tipo !== "sem-prazo") throw new Error("tinha prazo");
    expect(r.tempo.frase).toBe(
      "Atenção: com o que sobra hoje, os juros do rotativo do cartão crescem mais rápido do que você paga. Renegociar ou trocar por uma linha mais barata não é opcional — é o único caminho.",
    );
    expect(gerarPlano({ ...SO_ACELERADO, custoMoradia: 1700 }).proximosPassos).toContain(r.tempo.frase);
    expect(r.tempo.verDetalhes).toEqual({ rotulo: "Ver como nos detalhes", secao: "dividas" });
    expect(r.acaoSugerida).toBeUndefined();
  });
});

describe("respostaDoPlano — objetivo por dívida", () => {
  it("usa o nome curto da dívida", () => {
    expect(doPlano({ ...PERFIL_A, dividas: [{ tipo: "cheque_especial", saldo: 800 }] }).objetivo).toBe(
      "Quitar o cheque especial",
    );
    expect(doPlano({ ...PERFIL_A, dividas: [{ tipo: "emprestimo", saldo: 800 }] }).objetivo).toBe(
      "Quitar o empréstimo",
    );
    expect(
      doPlano({
        ...PERFIL_A,
        dividas: [
          { tipo: "rotativo", saldo: 800 },
          { tipo: "cheque_especial", saldo: 300 },
        ],
      }).objetivo,
    ).toBe("Quitar as dívidas caras");
  });

  it("dívida média no degrau 3: antecipar o financiamento", () => {
    const r = doPlano({
      ...PERFIL_A,
      guardado: 10000,
      dividas: [{ tipo: "financiamento", saldo: 8000, parcela: 300 }],
    });
    expect(r.objetivo).toBe("Antecipar o financiamento");
    expect(r.tempo.tipo).toBe("prazo");
    expect(r.anuncio).toMatch(/^Equilibrado: separe .* O financiamento acaba em /);
  });

  it("NOME_CURTO_DIVIDA tem todos os tipos", () => {
    expect(NOME_CURTO_DIVIDA).toEqual({
      rotativo: "o cartão",
      cheque_especial: "o cheque especial",
      emprestimo: "o empréstimo",
      financiamento: "o financiamento",
      outra: "a dívida",
    });
  });
});

describe("respostaDoPlano — modo corte", () => {
  it("falta R$ 50: cortar R$ 230 nos custos fixos", () => {
    const r = deCorte({
      rendaMensal: 1800,
      tipoRenda: "clt",
      idade: 24,
      moradia: "aluguel",
      custoMoradia: 1100,
      gastosFixos: [
        { categoria: "mercado", valor: 600 },
        { categoria: "celular", valor: 150 },
      ],
      dividas: [],
      guardado: 0,
    });
    expect(r.eyebrow).toBe("Plano de corte · setembro de 2026");
    expect(r.objetivo).toBe("Fazer a conta fechar");
    expect(r.valorMes).toBe(230);
    expect(r.linhaValor).toBe("pra cortar nos custos fixos");
    expect(r.falta).toBe(50);
    expect(r.linhaFalta).toBe(`Hoje falta ${formatBRL(50)} por mês`);
    expect(r.frase).toBe(
      `Cortando ${formatBRL(230)}, a conta fecha e sobram ${formatBRL(180)} (10% da renda) pra começar o plano.`,
    );
    expect(r.porOndeComecar.titulo).toBe("Por onde começar");
    expect(r.porOndeComecar.sugestoes).toHaveLength(2);
    expect(r.semDivisor).toBe("Quando sobrar dinheiro, é aqui que você divide o que sobra.");
  });

  it("renda empatando com as contas", () => {
    const r = deCorte({ ...PERFIL_PRINT, custoMoradia: 1323 });
    expect(r.falta).toBe(0);
    expect(r.linhaFalta).toBe("Hoje a renda empata com as contas");
    expect(r.valorMes).toBe(150);
  });
});

describe("sem jargão na superfície", () => {
  const perfis: Perfil[] = [
    PERFIL_A,
    { ...PERFIL_A, ritmo: "acelerado" },
    { ...PERFIL_A, aporteEscolhido: 0 },
    PERFIL_PRINT,
    { ...PERFIL_PRINT, guardado: 0 },
    SO_ACELERADO,
    { ...SO_ACELERADO, custoMoradia: 1700 },
    { ...PERFIL_A, dividas: [], guardado: 10000 },
    { ...PERFIL_A, custoMoradia: 3000 },
  ];

  it("nenhuma frase fala em aporte, excedente, degrau, cascata ou alocação", () => {
    for (const p of perfis) {
      const texto = JSON.stringify(resposta(p));
      expect(texto).not.toMatch(/aporte|excedente|degrau|cascata|aloca/i);
    }
  });
});

describe("textosDivisor", () => {
  it("monta as frases do divisor com os números", () => {
    expect(textosDivisor.equacao(2800, 1600, 1200)).toBe(
      `${formatBRL(2800)} − ${formatBRL(1600)} de contas = ${formatBRL(1200)} pra dividir`,
    );
    expect(textosDivisor.maximoAgora(76)).toBe("O máximo agora é 76%: o resto já está nos outros potes.");
    expect(textosDivisor.maximoAgora(100)).toBe("O máximo é 100%: é tudo o que sobra.");
    expect(textosDivisor.passouDaSobra(120)).toBe(`Seus potes passam do que sobra em ${formatBRL(120)}.`);
    expect(textosDivisor.praVoce(180)).toBe("livre pro dia a dia");
    expect(textosDivisor.praVoce(0)).toBe("tudo foi pros potes");
    expect(textosDivisor.potesDiminuiram("acelerado")).toBe("Os outros potes diminuíram pra caber o Acelerado.");
    expect(textosDivisor.voltarProRitmo("equilibrado", 70)).toBe("Voltar pro Equilibrado (70%)");
  });
});

describe("textosPote", () => {
  it("monta as frases das linhas e gavetas de pote", () => {
    expect(textosPote.maxRendimento).toBe("O máximo aqui é 5% ao mês.");
    expect(textosPote.ligarEntraNaMeta("Casa")).toContain("ligue “Entra na meta Casa”");
    expect(textosPote.guardarAntesDaMeta("Casa")).toContain("Por enquanto o Guardar paga o que vem antes da meta");
    expect(textosPote.poteNovoComeca(10, 120)).toBe("Escolha um nome. Ele começa com 10% e você ajusta depois.");
    expect(textosPote.poteNovoComeca(0, 0.5)).toBe(`Escolha um nome. Ele começa com ${formatBRL(0.5)} e você ajusta depois.`);
  });

  it("nenhuma frase fala em aporte, excedente, degrau, cascata ou alocação", () => {
    const frases = [
      textosPote.maxRendimento,
      textosPote.rendimentoSemMeta,
      textosPote.ligarEntraNaMeta("Casa"),
      textosPote.guardarAntesDaMeta("Casa"),
      textosPote.guardarAindaNaoEntra("Casa"),
      textosPote.poteNovoComeca(10, 120),
    ];
    for (const f of frases) expect(f).not.toMatch(/aporte|excedente|degrau|cascata|aloca/i);
  });
});
