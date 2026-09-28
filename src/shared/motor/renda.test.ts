/*
  GERADO a partir de dindinFrontend/src/domain/renda.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { TABELAS_FOLHA } from "./config";
import { brutoParaLiquido, calcularINSS, calcularIRRF } from "./renda";
import { arredondar } from "./format";

/*
  Bruto → líquido. Aqui o erro custa caro e é invisível: um centavo torto no
  INSS vira um líquido torto, que vira a renda do perfil, que vira o excedente,
  que vira o plano inteiro. Por isso todo caso da tabela da especificação é
  conferido no centavo, e não com `toBeCloseTo`.
*/

/** Dinheiro de verdade tem no máximo 2 casas. Escrito aqui de propósito: o domínio é copiado pro backend e não pode importar nada de lá. */
function temNoMaximoDuasCasas(valor: number): boolean {
  if (!Number.isFinite(valor)) return false;
  const texto = String(valor);
  // notação científica (1e-7) nunca é um valor de holerite — reprova
  if (texto.includes("e") || texto.includes("E")) return false;
  const ponto = texto.indexOf(".");
  return ponto === -1 || texto.length - ponto - 1 <= 2;
}

/** Data de hoje no fuso de quem roda o teste, como "AAAA-MM-DD" (comparável com `vigenciaAte` por string). */
function hojeISO(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** A faixa de IRRF de uma base — igual à do domínio, repetida aqui pra os testes não dependerem de detalhe interno. */
function faixaDe(base: number) {
  return TABELAS_FOLHA.irrf.find((f) => base <= f.ate) ?? TABELAS_FOLHA.irrf[TABELAS_FOLHA.irrf.length - 1];
}

/** O imposto apurado ANTES do redutor da Lei 15.270 — referência pra provar onde o redutor morde e onde não morde. */
function impostoSemRedutor(rendimento: number, dependentes = 0): number {
  const legais = calcularINSS(rendimento) + dependentes * TABELAS_FOLHA.dependente;
  const base = Math.max(0, rendimento - Math.max(legais, TABELAS_FOLHA.simplificado));
  const faixa = faixaDe(base);
  return arredondar(Math.max(0, base * faixa.aliquota - faixa.deduzir));
}

interface CasoFolha {
  bruto: number;
  dependentes: number;
  inss: number;
  irrf: number;
  liquido: number;
}

/*
  GOLDEN da competência 2026-01.

  Os casos são nomeados pela competência de propósito. A tabela da folha muda
  todo ano; quando mudar, o teste logo abaixo fica vermelho e obriga quem
  atualizar a ESCREVER um bloco golden novo, com as respostas novas, em vez de
  editar estes números. Sem isso, "atualizei a tabela" muda em silêncio o
  líquido de todo mundo que já usou o produto em 2026.
*/
const GOLDEN_2026_01: CasoFolha[] = [
  { bruto: 2500, dependentes: 0, inss: 200.69, irrf: 0, liquido: 2299.31 },
  { bruto: 3500, dependentes: 0, inss: 308.6, irrf: 0, liquido: 3191.4 },
  { bruto: 5000, dependentes: 0, inss: 501.51, irrf: 0, liquido: 4498.49 },
  { bruto: 6000, dependentes: 0, inss: 641.51, irrf: 385.1, liquido: 4973.39 },
  { bruto: 6000, dependentes: 1, inss: 641.51, irrf: 332.97, liquido: 5025.52 },
  { bruto: 8000, dependentes: 0, inss: 921.51, irrf: 1037.85, liquido: 6040.64 },
  { bruto: 12000, dependentes: 0, inss: 988.09, irrf: 2119.55, liquido: 8892.36 },
];

describe("validade da tabela da folha", () => {
  it("a tabela em config.ts ainda está vigente hoje", () => {
    expect(
      hojeISO() <= TABELAS_FOLHA.vigenciaAte,
      `A tabela da folha venceu em ${TABELAS_FOLHA.vigenciaAte} (hoje é ${hojeISO()}). ` +
        "Ela precisa ser atualizada em config.ts: INSS pela portaria interministerial do ano, " +
        "IRRF pela tabela mensal da Receita e o redutor pela lei em vigor. " +
        "Depois, escreva um bloco golden novo com a competência nova — não edite o bloco antigo. " +
        "Enquanto a tabela estiver vencida, a prévia do líquido está mentindo pra quem digita o bruto.",
    ).toBe(true);
  });

  it("as faixas estão em ordem crescente e a última do IRRF é aberta", () => {
    // o domínio depende disso: o INSS percorre as faixas acumulando e o IRRF usa o primeiro `ate` que couber
    const tetosINSS = TABELAS_FOLHA.inss.map((f) => f.ate);
    expect(tetosINSS).toEqual([...tetosINSS].sort((a, b) => a - b));
    const tetosIRRF = TABELAS_FOLHA.irrf.map((f) => f.ate);
    expect(tetosIRRF).toEqual([...tetosIRRF].sort((a, b) => a - b));
    expect(tetosIRRF[tetosIRRF.length - 1]).toBe(Infinity);
  });
});

describe("golden 2026-01 — os casos da especificação, no centavo", () => {
  it("config.ts ainda está na competência 2026-01", () => {
    expect(
      TABELAS_FOLHA.competencia,
      "A competência da tabela mudou. NÃO edite os números de GOLDEN_2026_01: crie um bloco " +
        "golden novo pra competência nova e deixe este como histórico. Ele existe justamente " +
        "pra atualização de tabela nunca mudar em silêncio as respostas de 2026.",
    ).toBe("2026-01");
  });

  it.each(GOLDEN_2026_01)(
    "bruto $bruto com $dependentes dependente(s) → INSS $inss, IRRF $irrf, líquido $liquido",
    ({ bruto, dependentes, inss, irrf, liquido }) => {
      expect(calcularINSS(bruto)).toBe(inss);
      expect(calcularIRRF(bruto, { dependentes })).toBe(irrf);
      expect(brutoParaLiquido(bruto, { dependentes })).toEqual({ bruto, inss, irrf, liquido });
    },
  );

  it("o teto do INSS trava: de 8.475,55 pra cima a contribuição não sobe mais", () => {
    const teto = TABELAS_FOLHA.inss[TABELAS_FOLHA.inss.length - 1].ate;
    const contribuicaoMaxima = calcularINSS(teto);
    expect(contribuicaoMaxima).toBe(988.09);
    expect(calcularINSS(teto + 0.01)).toBe(contribuicaoMaxima);
    expect(calcularINSS(12000)).toBe(contribuicaoMaxima);
    expect(calcularINSS(1_000_000)).toBe(contribuicaoMaxima);
  });
});

describe("calcularINSS", () => {
  it("é progressivo: cada faixa incide só sobre a parcela dentro dela", () => {
    // no fim exato de uma faixa, a contribuição é a soma acumulada até ali
    expect(calcularINSS(1621)).toBe(121.57);
    expect(calcularINSS(2902.84)).toBe(236.94);
    expect(calcularINSS(4354.27)).toBe(411.11);
  });

  it("nunca passa da contribuição máxima e nunca é negativo", () => {
    const maxima = calcularINSS(TABELAS_FOLHA.inss[TABELAS_FOLHA.inss.length - 1].ate);
    for (let centavos = 0; centavos <= 1_500_000; centavos += 137) {
      const valor = calcularINSS(centavos / 100);
      expect(valor).toBeGreaterThanOrEqual(0);
      expect(valor).toBeLessThanOrEqual(maxima);
    }
  });

  it("arredondar faixa a faixa ERRA — e é por isso que o total é arredondado uma vez só", () => {
    /*
      Este teste existe pra impedir uma "simplificação" futura. A versão errada
      abaixo é o que sai naturalmente de quem arredonda dentro do laço: em
      R$ 2.500 ela devolve 200,68 porque 1.621 × 7,5% = 121,574999… em ponto
      flutuante e vira 121,57. O valor correto é 200,69.
    */
    function inssArredondandoFaixaAFaixa(rendimento: number): number {
      let total = 0;
      let pisoDaFaixa = 0;
      for (const faixa of TABELAS_FOLHA.inss) {
        if (rendimento <= pisoDaFaixa) break;
        total += arredondar((Math.min(rendimento, faixa.ate) - pisoDaFaixa) * faixa.aliquota);
        pisoDaFaixa = faixa.ate;
      }
      return arredondar(total);
    }

    expect(inssArredondandoFaixaAFaixa(2500)).toBe(200.68);
    expect(calcularINSS(2500)).toBe(200.69);
    expect(calcularINSS(2500)).not.toBe(inssArredondandoFaixaAFaixa(2500));
  });

  it("entrada inválida devolve 0 em vez de explodir — isto roda a cada tecla digitada", () => {
    expect(calcularINSS(0)).toBe(0);
    expect(calcularINSS(-3000)).toBe(0);
    expect(calcularINSS(Number.NaN)).toBe(0);
    expect(calcularINSS(Infinity)).toBe(0);
    expect(calcularINSS(-Infinity)).toBe(0);
  });
});

describe("calcularIRRF — deduções legais × desconto simplificado", () => {
  it("o simplificado substitui as deduções legais, nunca soma com elas", () => {
    // em 5.200 o INSS (529,51) é menor que o simplificado (607,20): quem vale é o simplificado
    expect(calcularINSS(5200)).toBe(529.51);
    expect(calcularINSS(5200)).toBeLessThan(TABELAS_FOLHA.simplificado);
    expect(calcularIRRF(5200)).toBe(71.62);
    // se as duas somassem, a base cairia mais 607,20 e o imposto seria bem menor
    expect(calcularIRRF(5200)).toBeGreaterThan(0);
  });

  it("a virada acontece quando o INSS passa do simplificado, por volta de 5.754,90", () => {
    // abaixo: simplificado manda
    expect(calcularINSS(5700)).toBe(599.51);
    expect(calcularINSS(5700)).toBeLessThan(TABELAS_FOLHA.simplificado);
    // acima: as deduções legais mandam
    expect(calcularINSS(5800)).toBe(613.51);
    expect(calcularINSS(5800)).toBeGreaterThan(TABELAS_FOLHA.simplificado);
    // e a virada é lisa: no último centavo de cada lado o imposto é o mesmo
    expect(calcularINSS(5754.93)).toBe(TABELAS_FOLHA.simplificado);
    expect(calcularINSS(5754.94)).toBeGreaterThan(TABELAS_FOLHA.simplificado);
    expect(calcularIRRF(5754.93)).toBe(294.52);
    expect(calcularIRRF(5754.94)).toBe(294.52);
  });

  it("o imposto nunca dá um salto ao cruzar a virada", () => {
    let anterior = calcularIRRF(5700);
    for (let centavos = 570_001; centavos <= 580_000; centavos++) {
      const atual = calcularIRRF(centavos / 100);
      expect(atual).toBeGreaterThanOrEqual(anterior);
      expect(atual - anterior).toBeLessThan(0.02);
      anterior = atual;
    }
  });
});

describe("calcularIRRF — dependentes, pensão e previdência", () => {
  it("cada dependente derruba a base em 189,59 e o imposto na alíquota da faixa", () => {
    // em 6.000 as deduções legais já mandam e a faixa não muda: cada dependente vale 189,59 × 27,5%
    const semDependente = calcularIRRF(6000);
    const porDependente = [semDependente, 332.97, 280.83, 228.69];
    for (let d = 0; d < porDependente.length; d++) {
      expect(calcularIRRF(6000, { dependentes: d })).toBe(porDependente[d]);
    }
    const aliquotaDaFaixa = 0.275;
    for (let d = 1; d < porDependente.length; d++) {
      const economia = porDependente[d - 1] - porDependente[d];
      expect(economia).toBeCloseTo(TABELAS_FOLHA.dependente * aliquotaDaFaixa, 1);
    }
  });

  it("quando o simplificado vencia sozinho, o primeiro dependente rende MENOS que os outros", () => {
    /*
      Em 5.200 o INSS é 529,51 e o simplificado 607,20. O primeiro dependente não
      vale 189,59 inteiros: ele só compra a diferença entre 529,51 + 189,59 e os
      607,20 que já estavam valendo. É a prova de que a regra é um `max`, e não
      uma soma — se alguém trocar por soma, este número muda.
    */
    expect(calcularIRRF(5200)).toBe(71.62);
    expect(calcularIRRF(5200, { dependentes: 1 })).toBe(46.45);
    const economiaDoPrimeiro = 71.62 - 46.45;
    expect(economiaDoPrimeiro).toBeCloseTo(25.17, 2);
    // o dependente inteiro valeria 42,66 nessa faixa; aqui ele só comprou a diferença pro simplificado
    expect(economiaDoPrimeiro).toBeLessThan(TABELAS_FOLHA.dependente * 0.225);
    const soASobra = (calcularINSS(5200) + TABELAS_FOLHA.dependente - TABELAS_FOLHA.simplificado) * 0.225;
    expect(economiaDoPrimeiro).toBeCloseTo(soASobra, 1);
  });

  it("pensão alimentícia deduz da base: bruto 6.000 com pensão de 1.000 → IRRF 125,42", () => {
    expect(calcularIRRF(6000, { pensaoAlimenticia: 1000 })).toBe(125.42);
    expect(brutoParaLiquido(6000, { pensaoAlimenticia: 1000 })).toEqual({
      bruto: 6000,
      inss: 641.51,
      irrf: 125.42,
      liquido: 5233.07,
    });
  });

  it("previdência em folha também deduz, e as três deduções somam entre si", () => {
    expect(calcularIRRF(6000, { previdenciaFolha: 500 })).toBe(247.6);
    expect(calcularIRRF(6000, { pensaoAlimenticia: 1000, dependentes: 1 })).toBe(82.76);
    expect(calcularIRRF(8000, { dependentes: 2, pensaoAlimenticia: 500, previdenciaFolha: 300 })).toBe(713.58);
  });

  it("dedução inválida é ignorada, não vira crédito", () => {
    const semNada = calcularIRRF(6000);
    expect(calcularIRRF(6000, {})).toBe(semNada);
    expect(calcularIRRF(6000, { dependentes: -3 })).toBe(semNada);
    expect(calcularIRRF(6000, { dependentes: Number.NaN, pensaoAlimenticia: -1000 })).toBe(semNada);
    expect(calcularIRRF(6000, { previdenciaFolha: Infinity })).toBe(semNada);
    // dependente é contagem: fração não conta meio dependente
    expect(calcularIRRF(6000, { dependentes: 1.9 })).toBe(calcularIRRF(6000, { dependentes: 1 }));
  });

  it("dedução gigante zera o imposto, nunca deixa negativo", () => {
    expect(calcularIRRF(8000, { pensaoAlimenticia: 100000 })).toBe(0);
    expect(calcularIRRF(12000, { dependentes: 100 })).toBe(0);
  });

  it("entrada inválida devolve 0", () => {
    expect(calcularIRRF(0)).toBe(0);
    expect(calcularIRRF(-6000, { dependentes: 1 })).toBe(0);
    expect(calcularIRRF(Number.NaN)).toBe(0);
    expect(calcularIRRF(Infinity)).toBe(0);
  });
});

describe("redutor da Lei 15.270", () => {
  it("até 5.000 o imposto zera — em TODO centavo, não só no número redondo", () => {
    expect(calcularIRRF(5000)).toBe(0);
    expect(impostoSemRedutor(5000)).toBe(TABELAS_FOLHA.redutor.teto);
    for (let centavos = 0; centavos <= 500_000; centavos += 7) {
      expect(calcularIRRF(centavos / 100)).toBe(0);
    }
  });

  it("logo acima de 5.000 não existe salto: nada de imposto negativo nem degrau", () => {
    /*
      É aqui que a fórmula da lei e o teto se encontram. Em 5.000,01 a fórmula
      apura um redutor de 312,8937 contra um imposto de 312,8922 — se o resultado
      não tivesse piso zero, o holerite mostraria imposto de −0,01 e o líquido
      ficaria MAIOR que o bruto menos o INSS.
    */
    let anterior = 0;
    for (let centavos = 500_000; centavos <= 500_100; centavos++) {
      const irrf = calcularIRRF(centavos / 100);
      expect(irrf, `bruto ${centavos / 100}`).toBeGreaterThanOrEqual(anterior);
      // sobe de centavo em centavo, nunca de degrau
      expect(arredondar(irrf - anterior), `bruto ${centavos / 100}`).toBeLessThanOrEqual(0.01);
      anterior = irrf;
    }
    // um real acima do teto da isenção o imposto ainda é troco, não um degrau
    expect(anterior).toBeLessThan(1);
    expect(calcularIRRF(5000.01)).toBe(0);
    expect(calcularIRRF(5000.02)).toBe(0);
    expect(calcularIRRF(5000.03)).toBe(0.01);
  });

  it("em 7.350 o redutor já não vale nada, e um real antes ainda valia", () => {
    const limite = TABELAS_FOLHA.redutor.ate;
    expect(limite).toBe(7350);
    // no limite o redutor apurado é menos de um centavo: o imposto com e sem redutor é o mesmo
    expect(calcularIRRF(limite)).toBe(impostoSemRedutor(limite));
    expect(calcularIRRF(limite)).toBe(884.13);
    // um real antes ele ainda mordia
    expect(calcularIRRF(limite - 1)).not.toBe(impostoSemRedutor(limite - 1));
    expect(calcularIRRF(limite - 1)).toBe(883.76);
    // acima do limite não existe redutor nenhum
    expect(calcularIRRF(limite + 0.01)).toBe(impostoSemRedutor(limite + 0.01));
    expect(calcularIRRF(8000)).toBe(impostoSemRedutor(8000));
  });

  it("a forma fechada do domínio é a mesma função das três faixas da lei", () => {
    /*
      O domínio escreve o redutor como `min(teto, a − b × rendimento)` em vez das
      três faixas com o literal 5.000. É a mesma função — a reta só desce abaixo
      do teto depois dos R$ 5.000 —, e escrito assim o limite da isenção sai da
      tabela em vez de estar chumbado no código. Este teste guarda a equivalência.
    */
    const { teto, a, b, ate } = TABELAS_FOLHA.redutor;
    function comoALeiEscreve(rendimento: number, dependentes: number): number {
      const legais = calcularINSS(rendimento) + dependentes * TABELAS_FOLHA.dependente;
      const base = Math.max(0, rendimento - Math.max(legais, TABELAS_FOLHA.simplificado));
      const faixa = faixaDe(base);
      const imposto = Math.max(0, base * faixa.aliquota - faixa.deduzir);
      const redutor = rendimento <= 5000 ? teto : rendimento <= ate ? Math.max(0, a - b * rendimento) : 0;
      return arredondar(Math.max(0, imposto - Math.min(redutor, imposto)));
    }

    // varredura larga em passo de um real…
    for (let reais = 0; reais <= 12000; reais++) {
      for (const dependentes of [0, 1, 3]) {
        expect(calcularIRRF(reais, { dependentes }), `bruto ${reais}, ${dependentes} dep`).toBe(
          comoALeiEscreve(reais, dependentes),
        );
      }
    }
    // …e centavo a centavo nas duas fronteiras, que é onde as duas formas poderiam divergir
    for (const inicio of [499_900, 734_900]) {
      for (let centavos = inicio; centavos <= inicio + 200; centavos++) {
        const valor = centavos / 100;
        expect(calcularIRRF(valor), `bruto ${valor}`).toBe(comoALeiEscreve(valor, 0));
      }
    }
  });
});

describe("brutoParaLiquido", () => {
  const brutos = [0, 0.01, 1, 1621, 2500, 2500.37, 3247.789, 4999.99, 5000, 5000.03, 5754.93, 7350, 8475.55, 12000, 99999.99];

  it("todo campo do holerite tem no máximo 2 casas decimais", () => {
    for (const bruto of brutos) {
      for (const dependentes of [0, 1, 5]) {
        const holerite = brutoParaLiquido(bruto, { dependentes, pensaoAlimenticia: 333.33 });
        for (const [campo, valor] of Object.entries(holerite)) {
          expect(temNoMaximoDuasCasas(valor), `bruto ${bruto}: ${campo} = ${valor}`).toBe(true);
        }
      }
    }
  });

  it("o holerite fecha: bruto − INSS − IRRF é exatamente o líquido", () => {
    for (let centavos = 0; centavos <= 1_500_000; centavos += 197) {
      const holerite = brutoParaLiquido(centavos / 100, { dependentes: centavos % 3 });
      expect(arredondar(holerite.bruto - holerite.inss - holerite.irrf)).toBe(holerite.liquido);
      expect(holerite.liquido).toBeLessThanOrEqual(holerite.bruto);
      expect(holerite.liquido).toBeGreaterThanOrEqual(0);
    }
  });

  it("arredonda o bruto ANTES da conta, pra tela e holerite não discordarem", () => {
    // uma máscara ou uma divisão pode entregar mais de duas casas; o holerite tem que fechar mesmo assim
    const holerite = brutoParaLiquido(3247.789);
    expect(holerite.bruto).toBe(3247.79);
    expect(holerite.inss).toBe(calcularINSS(3247.79));
    expect(holerite.irrf).toBe(calcularIRRF(3247.79));
    expect(holerite.liquido).toBe(arredondar(3247.79 - holerite.inss - holerite.irrf));
  });

  it("NÃO desconta vale-transporte nem plano de saúde: o líquido é só o fiscal", () => {
    /*
      Se um dia alguém adicionar `descontosFolha` aqui, este teste cai. VT e plano
      de saúde entram no plano como gasto fixo (`transporte_publico`, `plano_saude`);
      descontar nos dois lugares tiraria o mesmo dinheiro duas vezes do excedente.
    */
    const holerite = brutoParaLiquido(3500);
    expect(holerite.liquido).toBe(3500 - holerite.inss - holerite.irrf);
    expect(holerite.liquido).toBe(3191.4);
  });

  it("bruto abaixo do salário mínimo calcula normal — quem avisa é a tela", () => {
    const meioSalario = TABELAS_FOLHA.salarioMinimo / 2;
    const holerite = brutoParaLiquido(meioSalario);
    expect(holerite.inss).toBe(arredondar(meioSalario * TABELAS_FOLHA.inss[0].aliquota));
    expect(holerite.irrf).toBe(0);
    expect(holerite.liquido).toBeGreaterThan(0);
  });

  it("entrada inválida devolve um holerite de zeros, não uma exceção", () => {
    const zerado = { bruto: 0, inss: 0, irrf: 0, liquido: 0 };
    expect(brutoParaLiquido(0)).toEqual(zerado);
    expect(brutoParaLiquido(-5000)).toEqual(zerado);
    expect(brutoParaLiquido(Number.NaN)).toEqual(zerado);
    expect(brutoParaLiquido(Infinity, { dependentes: 2 })).toEqual(zerado);
  });

  it("o líquido cresce junto com o bruto — nenhuma faixa deixa a pessoa pior", () => {
    let anterior = -1;
    for (let centavos = 0; centavos <= 1_500_000; centavos += 313) {
      const { liquido } = brutoParaLiquido(centavos / 100);
      expect(liquido).toBeGreaterThanOrEqual(anterior);
      anterior = liquido;
    }
  });
});
