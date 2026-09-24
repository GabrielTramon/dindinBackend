/*
  GERADO a partir de dindinFrontend/src/domain/coerencia.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { simularRitmos } from "./divisor";
import { aportePrevistoNasMetas, caminhoDoPlano, marcosDoPlano } from "./marcos";
import { gerarPlano } from "./motor";
import { projetarMeta, type Grupo } from "./organizacao";
import { respostaDoPlano, type RespostaPlano } from "./resposta";
import { RITMOS } from "./schema";
import { textos } from "./textos";
import type { Meta, Perfil } from "./types";
import { formatBRL, formatMeses } from "./format";

/*
  O plano fala em quatro lugares — o cartão do topo, "Seu caminho", os
  detalhes e os próximos passos — e os quatro precisam dizer a MESMA coisa.
  Cada bloco aqui reproduz um caso em que eles se contradiziam (ou afirmavam
  algo falso) depois que o "Guardar" passou a ir até 100% à mão e os potes
  passaram a entrar na meta.
*/

const HOJE = new Date(2026, 8, 24); // setembro de 2026

const VIAGEM: Meta = { tipo: "viagem", valorAlvo: 6000 };

/** sobra 1.200; rotativo de 1.500; reserva faltando */
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
  meta: VIAGEM,
};

/** o mesmo perfil já no degrau 4: sobra 1.200, equilibrado guarda 360 */
const RESOLVIDO: Perfil = { ...PERFIL_A, dividas: [], guardado: 10000 };

const guardar = (valor: number, contaParaMeta = false, rendimentoMensal?: number): Grupo => ({
  id: "guardar",
  nome: "Guardar",
  icone: "PiggyBank",
  valor,
  contaParaMeta,
  doSistema: true,
  ...(rendimentoMensal !== undefined ? { rendimentoMensal } : {}),
  itens: [],
});

const pote = (id: string, valor: number, contaParaMeta: boolean): Grupo => ({
  id,
  nome: id,
  icone: "Tag",
  valor,
  contaParaMeta,
  itens: [],
});

/** O cartão como a tela monta: com os potes e a projeção da meta que ela usa. */
function cartao(perfil: Perfil, grupos?: Grupo[]): RespostaPlano {
  const plano = gerarPlano(perfil);
  const lista = grupos ?? [guardar(plano.aporte, plano.degrau === 4)];
  const meta = perfil.meta;
  const aporteQueConta =
    plano.degrau === 4 && !lista.some((g) => g.doSistema && g.contaParaMeta) ? plano.aporte : 0;
  const r = respostaDoPlano(plano, {
    meta,
    projecaoMeta: meta ? projetarMeta(meta, lista, aporteQueConta, HOJE) : null,
    simulacoes: simularRitmos(perfil),
    grupos: lista,
    hoje: HOJE,
  });
  if (r.modo !== "plano") throw new Error("esperava um plano, veio corte");
  return r;
}

describe("dívida cara que só o 100% à mão quita (nenhum ritmo resolve)", () => {
  /** sobra 500; o acelerado para em 350 pelo piso; guardando 500 o cartão zera em 22 meses */
  const SO_COM_TUDO: Perfil = {
    rendaMensal: 3000,
    tipoRenda: "clt",
    idade: 24,
    moradia: "aluguel",
    custoMoradia: 1500,
    gastosFixos: [{ categoria: "mercado", valor: 1000 }],
    dividas: [{ tipo: "rotativo", saldo: 3500, taxaAnual: 3.5 }],
    guardado: 5000,
  };

  it("o cenário: nenhum ritmo zera, mas guardar os R$ 500 zera em 22 meses", () => {
    for (const ritmo of RITMOS) {
      expect(gerarPlano({ ...SO_COM_TUDO, ritmo }).dividas.mesesParaQuitarCaras).toBeNull();
    }
    expect(gerarPlano({ ...SO_COM_TUDO, aporteEscolhido: 500 }).dividas.mesesParaQuitarCaras).toBe(22);
  });

  it("o diagnóstico guarda o prazo guardando tudo, e a frase não diz 'único caminho'", () => {
    const plano = gerarPlano(SO_COM_TUDO);
    expect(plano.diagnosticoCaras).toMatchObject({
      ritmoQueResolve: null,
      guardandoTudo: { valor: 500, meses: 22 },
    });
    const aviso = plano.proximosPassos.find((t) => t.includes("tudo o que sobra"))!;
    expect(aviso).toBe(
      `Neste ritmo, os juros crescem mais rápido do que você paga. Guardando tudo o que sobra (${formatBRL(500)}), o rotativo do cartão zera em ${formatMeses(22)}; renegociar ou trocar por uma linha mais barata ainda ajuda a sair antes.`,
    );
    for (const t of plano.proximosPassos) expect(t).not.toContain("único caminho");
  });

  it("o cartão diz a MESMA frase dos próximos passos, e o link pra renegociar continua", () => {
    const plano = gerarPlano(SO_COM_TUDO);
    const r = cartao(SO_COM_TUDO);
    if (r.tempo.tipo !== "sem-prazo") throw new Error("tinha prazo");
    expect(plano.proximosPassos).toContain(r.tempo.frase);
    expect(r.tempo.frase).toContain("Guardando tudo o que sobra");
    expect(r.tempo.verDetalhes).toBeDefined();
    expect(r.acaoSugerida).toBeUndefined();
  });

  it("com o Guardar editado abaixo do que resolve, a frase fala do valor dela", () => {
    const plano = gerarPlano({ ...SO_COM_TUDO, aporteEscolhido: 450 });
    expect(plano.dividas.mesesParaQuitarCaras).toBeNull();
    const aviso = plano.proximosPassos.find((t) => t.includes("tudo o que sobra"))!;
    expect(aviso.startsWith(`Guardando ${formatBRL(450)} por mês, `)).toBe(true);
  });

  it("'único caminho' continua quando nem 100% resolve — e quando ela já guarda 100%", () => {
    const semSaida: Perfil = { ...SO_COM_TUDO, dividas: [{ tipo: "rotativo", saldo: 30000 }] };
    const plano = gerarPlano(semSaida);
    expect(plano.diagnosticoCaras).toMatchObject({ ritmoQueResolve: null, guardandoTudo: null });
    expect(plano.proximosPassos.some((t) => t.includes("é o único caminho"))).toBe(true);

    const tudo = gerarPlano({ ...semSaida, aporteEscolhido: 500 });
    expect(tudo.diagnosticoCaras).toMatchObject({ ritmoQueResolve: null, guardandoTudo: null });
    expect(tudo.proximosPassos.some((t) => t.includes("é o único caminho"))).toBe(true);
  });
});

describe("o fecho do cartão conta os potes", () => {
  it("potes ocupando o que o Guardar deixa: 'tudo vai pros potes', nunca 'os outros R$ 360 são seus'", () => {
    const plano = gerarPlano(PERFIL_A);
    const r = cartao(PERFIL_A, [guardar(plano.aporte), pote("Lazer", 360, false)]);
    expect(r.fecho).toBe("Tudo o que sobra vai pros seus potes este mês.");
  });

  it("com parte fora dos potes, o valor é o que sobra depois de TODOS eles", () => {
    const plano = gerarPlano(PERFIL_A);
    const r = cartao(PERFIL_A, [guardar(plano.aporte), pote("Lazer", 200, false)]);
    expect(r.fecho).toBe(`Os ${formatBRL(160)} que ficam fora dos potes são seus, sem culpa.`);
  });

  it("potes que passam da sobra (dado antigo) também não deixam nada livre", () => {
    const plano = gerarPlano(PERFIL_A);
    expect(cartao(PERFIL_A, [guardar(plano.aporte), pote("Lazer", 900, false)]).fecho).toBe(
      "Tudo o que sobra vai pros seus potes este mês.",
    );
  });

  it("sem potes, o fecho de sempre", () => {
    expect(cartao(PERFIL_A).fecho).toBe(`Os outros ${formatBRL(360)} são seus, sem culpa.`);
  });

  it("os próximos passos não afirmam um 'livre' que os potes mudam", () => {
    const plano = gerarPlano(PERFIL_A);
    expect(plano.proximosPassos[0]).toBe(
      `Separe ${formatBRL(840)} no dia que a renda cair, antes de gastar. O que fica é seu pra usar sem culpa.`,
    );
  });

  it("com o Guardar em 0% também: o passo 1 não diz 'os R$ 1.200 são seus' enquanto o cartão desconta os potes", () => {
    const perfil: Perfil = { ...RESOLVIDO, aporteEscolhido: 0 };
    const plano = gerarPlano(perfil);
    expect(plano.aporte).toBe(0);
    expect(plano.livre).toBe(1200);

    // o cartão, que conhece os potes, é quem diz o valor
    expect(cartao(perfil, [guardar(0), pote("Lazer", 450, false)]).fecho).toBe(
      `Os ${formatBRL(750)} que ficam fora dos potes são seus, sem culpa.`,
    );
    expect(cartao(perfil, [guardar(0), pote("Lazer", 1200, false)]).fecho).toBe(
      "Tudo o que sobra vai pros seus potes este mês.",
    );
    // os próximos passos (que vão também pra API, sem os potes) não afirmam valor nenhum
    expect(plano.proximosPassos[0]).toBe("Este mês o plano não separa nada: o que sobra é seu pra usar sem culpa.");
    expect(plano.proximosPassos[0]).not.toContain("R$");
  });
});

describe("Guardar em 0% com potes que levam à meta (degrau 4)", () => {
  it("o cartão mostra o prazo dos potes, não 'Parado'", () => {
    const perfil: Perfil = { ...RESOLVIDO, aporteEscolhido: 0 };
    const r = cartao(perfil, [guardar(0, true), pote("Investimento", 300, true)]);
    expect(r.tempo).toMatchObject({ tipo: "prazo", meses: 20, mes: "maio de 2028" });
  });

  it("'Parado' só quando nada contribui", () => {
    const perfil: Perfil = { ...RESOLVIDO, aporteEscolhido: 0 };
    expect(cartao(perfil, [guardar(0, true), pote("Lazer", 300, false)]).tempo.tipo).toBe("parado");
  });
});

describe("antes do degrau 4, o Guardar marcado na meta não conta duas vezes", () => {
  it("aportePrevistoNasMetas ignora o 'entra na meta' do Guardar antes do degrau 4", () => {
    const plano = gerarPlano(PERFIL_A);
    expect(plano.degrau).toBe(1);
    expect(aportePrevistoNasMetas(plano, [guardar(840, true)])).toBe(360);
  });

  it("o caminho dá o mesmo prazo pra meta com a caixinha do Guardar ligada ou desligada", () => {
    const plano = gerarPlano(PERFIL_A);
    const desligada = marcosDoPlano(plano, { grupos: [guardar(840, false)], hoje: HOJE }).at(-1);
    const ligada = marcosDoPlano(plano, { grupos: [guardar(840, true)], hoje: HOJE }).at(-1);
    expect(desligada).toMatchObject({ id: "meta", meses: 27 });
    // antes: os 840 que pagam o cartão e enchem a reserva também "iam pra viagem" desde o mês 1
    expect(ligada).toMatchObject({ id: "meta", meses: 27 });
  });

  it("o rendimento do Guardar marcado só rende depois que o plano chega na meta", () => {
    const plano = gerarPlano(PERFIL_A);
    const inicio = plano.reserva.mesesParaCompletar!;
    const comRendimento = marcosDoPlano(plano, { grupos: [guardar(840, true, 0.01)], hoje: HOJE }).at(-1)!;
    expect(comRendimento.meses).toBeLessThan(27);
    expect(comRendimento.meses!).toBeGreaterThan(inicio);
  });

  it("no degrau 4 o Guardar marcado continua contando (e o aporte não entra duas vezes)", () => {
    const plano = gerarPlano(RESOLVIDO);
    expect(aportePrevistoNasMetas(plano, [guardar(plano.aporte, true)])).toBe(0);
    expect(aportePrevistoNasMetas(plano, [guardar(plano.aporte, false)])).toBe(plano.aporte);
  });
});

describe("'Sua meta' e 'Seu caminho' usam a mesma projeção", () => {
  it("meta que se funde com a reserva: o caminho expõe a projeção e o início que o marco usou", () => {
    // sem dívida: reserva em 7 meses; um pote de 100 marcado chega nos 700 no mesmo mês 7
    const perfil: Perfil = { ...PERFIL_A, dividas: [], meta: { tipo: "outro", nome: "Bike", valorAlvo: 700 } };
    const plano = gerarPlano(perfil);
    const caminho = caminhoDoPlano(plano, { grupos: [guardar(plano.aporte), pote("Bike", 100, true)], hoje: HOJE });
    const marco = caminho.marcos.find((m) => m.id.split("+").includes("meta"))!;
    expect(marco.id).toBe("reserva+meta");
    expect(marco.meses).toBe(7);
    expect(caminho.meta?.inicio).toBe(7);
    // antes os detalhes paravam no marco fundido, começavam o plano no mês 1 e diziam 2 meses
    expect(caminho.meta?.projecao.meses).toBe(7);
  });

  it("no degrau 4 é exatamente a projeção do cartão", () => {
    const plano = gerarPlano(RESOLVIDO);
    const grupos = [guardar(plano.aporte, true), pote("Investimento", 240, true)];
    const caminho = caminhoDoPlano(plano, { grupos, hoje: HOJE });
    expect(caminho.meta?.projecao).toEqual(projetarMeta(VIAGEM, grupos, 0, HOJE));
    // Guardar desmarcado: o aporte entra como o plano (sem rendimento), como a tela sempre fez
    const desmarcado = [guardar(plano.aporte, false, 0.01), pote("Investimento", 240, true)];
    expect(caminhoDoPlano(plano, { grupos: desmarcado, hoje: HOJE }).meta?.projecao).toEqual(
      projetarMeta(VIAGEM, desmarcado, plano.aporte, HOJE),
    );
  });
});

describe("meta que só os potes alcançam, com um passo de antes sem prazo", () => {
  it("o marco da meta mostra os meses dos potes em vez de travar em 'depois'", () => {
    const perfil: Perfil = {
      rendaMensal: 2000,
      tipoRenda: "clt",
      idade: 24,
      moradia: "aluguel",
      custoMoradia: 1700,
      gastosFixos: [],
      dividas: [{ tipo: "rotativo", saldo: 5000 }],
      guardado: 1000,
      meta: VIAGEM,
    };
    const plano = gerarPlano(perfil);
    expect(plano.dividas.mesesParaQuitarCaras).toBeNull();
    const caminho = caminhoDoPlano(plano, { grupos: [guardar(plano.aporte), pote("Viagem", 100, true)], hoje: HOJE });
    expect(caminho.marcos.map((m) => [m.id, m.meses, m.semPrazo])).toEqual([
      ["caras", null, true],
      ["reserva", null, false],
      ["meta", 60, false],
    ]);
    expect(caminho.marcos.at(-1)?.mes).toBe("set 2031");
    expect(caminho.meta).toMatchObject({ inicio: null, projecao: { meses: 60 } });
  });
});

describe("próximos passos com o Guardar em 100%", () => {
  it("sem 'O que fica — R$ 0 — é seu'", () => {
    const plano = gerarPlano({ ...PERFIL_A, aporteEscolhido: 1200 });
    expect(plano.livre).toBe(0);
    expect(plano.proximosPassos[0]).toBe(
      `Separe ${formatBRL(1200)} no dia que a renda cair, antes de gastar: este mês tudo o que sobra vai pro plano.`,
    );
    for (const t of plano.proximosPassos) expect(t).not.toContain(formatBRL(0));
  });
});

describe("próximos passos com o Guardar em 0%", () => {
  /** degrau 3: financiamento com parcela, reserva cheia */
  const MEDIA: Perfil = {
    ...PERFIL_A,
    guardado: 10000,
    dividas: [{ tipo: "financiamento", saldo: 8000, parcela: 300 }],
  };

  it("degrau 3: quem quita são só as parcelas — nada de 'Antecipando R$ 0'", () => {
    const plano = gerarPlano({ ...MEDIA, aporteEscolhido: 0 });
    expect(plano.degrau).toBe(3);
    const m = plano.dividas.mesesParaQuitarMedias!;
    expect(m).not.toBeNull();
    expect(plano.proximosPassos).toContain(`Só com as parcelas, o financiamento termina em ${formatMeses(m)}.`);
    for (const t of plano.proximosPassos) expect(t).not.toContain("Antecipando");
  });

  it("degrau 4: nada de 'Guarde os R$ 0'", () => {
    const plano = gerarPlano({ ...RESOLVIDO, aporteEscolhido: 0 });
    expect(plano.degrau).toBe(4);
    for (const t of plano.proximosPassos) {
      expect(t).not.toContain("Guarde os");
      expect(t).not.toContain(formatBRL(0));
    }
  });
});

describe("'Guarde uma fatia maior' só quando dá pra guardar mais", () => {
  it("meta que não fecha com o Guardar em 100%: só 'reveja o valor dela'", () => {
    const perfil: Perfil = { ...RESOLVIDO, meta: { tipo: "casa", valorAlvo: 100_000_000 }, aporteEscolhido: 1200 };
    const r = cartao(perfil);
    if (r.tempo.tipo !== "sem-prazo") throw new Error("tinha prazo");
    expect(r.tempo.frase).toBe(
      `Com ${formatBRL(1200)} por mês, a meta Casa não fecha nem em ${formatMeses(600)}. Reveja o valor dela.`,
    );
  });

  it("meta que não fecha com espaço sobrando: as duas saídas", () => {
    const r = cartao({ ...RESOLVIDO, meta: { tipo: "casa", valorAlvo: 100_000_000 } });
    if (r.tempo.tipo !== "sem-prazo") throw new Error("tinha prazo");
    expect(r.tempo.frase).toContain("Guarde uma fatia maior ou reveja o valor dela.");
  });

  it("dívida média que não acaba nem com 100%: não manda guardar uma fatia maior", () => {
    const perfil: Perfil = {
      ...RESOLVIDO,
      dividas: [{ tipo: "financiamento", saldo: 1_000_000 }],
      aporteEscolhido: 1200,
    };
    const plano = gerarPlano(perfil);
    expect(plano.degrau).toBe(3);
    expect(plano.dividas.mesesParaQuitarMedias).toBeNull();
    const r = cartao(perfil);
    if (r.tempo.tipo !== "sem-prazo") throw new Error("tinha prazo");
    expect(r.tempo.frase).not.toContain("fatia maior");
    expect(r.tempo.frase).toMatch(/^Mesmo com tudo o que sobra/);
  });

  it("a frase dos detalhes é a mesma função do cartão", () => {
    expect(textos.metaNaoFecha(1200, null, false)).toBe(
      `Com ${formatBRL(1200)} por mês, a meta não fecha nem em ${formatMeses(600)}. Reveja o valor dela.`,
    );
    expect(textos.metaNaoFecha(300, "Casa", true)).toBe(
      `Com ${formatBRL(300)} por mês, a meta Casa não fecha nem em ${formatMeses(600)}. Guarde uma fatia maior ou reveja o valor dela.`,
    );
  });
});

describe("a projeção de cada ritmo encolhe os outros potes como a troca de ritmo encolhe", () => {
  it("acelerado: os potes que não cabem encolhem antes de projetar a meta", () => {
    const meta: Meta = { tipo: "viagem", valorAlvo: 7200 };
    const perfil: Perfil = { ...RESOLVIDO, meta };
    const plano = gerarPlano(perfil);
    // Guardar 360 + Investimento 840 = a sobra inteira
    const r = cartao(perfil, [guardar(plano.aporte, false), pote("Investimento", 840, true)]);
    const acelerado = r.segmentos.find((s) => s.ritmo === "acelerado")!;
    expect(acelerado.valor).toBe(600);
    // trocar pro acelerado encolhe o Investimento pra 600: 600 + 600 = 1.200 por mês → 6 meses (não 5)
    expect(acelerado.descricaoSr).toBe(`${formatBRL(600)} por mês; você chega na meta Viagem em ${formatMeses(6)}`);
  });
});

describe("'Sobre os ritmos' diz a regra de verdade", () => {
  it("não promete 10% da renda livre em todo ritmo", () => {
    expect(textos.sobreOsRitmos).not.toContain("Nenhum ritmo deixa menos");
    expect(textos.sobreOsRitmos).toContain("10%");
    expect(textos.sobreOsRitmos).toContain("Equilibrado");
    expect(textos.sobreOsRitmos).toContain("100%");
  });

  it("a regra escrita vale: o acelerado só deixa menos de 10% da renda quando guarda o mesmo que o equilibrado", () => {
    for (const renda of [1500, 2000, 2800, 5000]) {
      for (const custo of [900, 1300, 1800]) {
        const perfil: Perfil = { ...RESOLVIDO, rendaMensal: renda, custoMoradia: custo, gastosFixos: [] };
        const acelerado = gerarPlano({ ...perfil, ritmo: "acelerado" });
        if (acelerado.modoCorte) continue;
        const equilibrado = gerarPlano({ ...perfil, ritmo: "equilibrado" });
        if (acelerado.livre < renda * 0.1) expect(acelerado.aporte).toBe(equilibrado.aporte);
        // nenhum ritmo sugere guardar tudo
        for (const ritmo of RITMOS) expect(gerarPlano({ ...perfil, ritmo }).livre).toBeGreaterThan(0);
      }
    }
  });
});

describe("sobra com centavos e o Guardar em 100%", () => {
  /** CLT com sobra de 1.000,55: o aporte fica em R$ 1.000 inteiros e R$ 0,55 'sobram' */
  const CENTAVOS: Perfil = {
    ...RESOLVIDO,
    rendaMensal: 2000.55,
    custoMoradia: 0,
    moradia: "pais",
    gastosFixos: [{ categoria: "mercado", valor: 1000 }],
  };

  it("o cartão diz 100% e 'tudo vai pros potes', não 'os outros R$ 1'", () => {
    const perfil = { ...CENTAVOS, aporteEscolhido: 1000.55 };
    const plano = gerarPlano(perfil);
    expect(plano.aporte).toBe(1000);
    const r = cartao(perfil);
    expect(r.pct).toBe(100);
    expect(r.livre).toBe(0);
    expect(r.valorMes).toBe(1000);
    expect(r.fecho).toBe("Tudo o que sobra vai pros seus potes este mês.");
    expect(plano.proximosPassos[0]).toContain("tudo o que sobra vai pro plano");
  });

  it("sobra pequena: o resíduo de centavos não derruba a % pra 98", () => {
    const perfil: Perfil = { ...CENTAVOS, rendaMensal: 1050.9, aporteEscolhido: 50.9 };
    const plano = gerarPlano(perfil);
    expect(plano.aporte).toBe(50);
    expect(cartao(perfil).pct).toBe(100);
  });
});
