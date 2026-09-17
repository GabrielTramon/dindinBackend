/*
  GERADO a partir de dindinFrontend/src/domain/schema.test.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { describe, expect, it } from "vitest";
import { MAX_DIVIDAS, MAX_GASTOS_FIXOS } from "./config";
import { MORADIAS, MORADIAS_SEM_CUSTO, TIPOS_DIVIDA, TIPOS_RENDA, perfilSchema, validarPerfil } from "./schema";
/** Açúcar dos testes: um gasto fixo único, pra cenários que só olham o total. */
const gastos = (valor: number) => (valor > 0 ? [{ categoria: "mercado", valor }] : []);


/*
  validarPerfil: ou o perfil válido, ou um mapa caminho → primeira mensagem (pt-BR).
  As mensagens aparecem na tela, então o texto exato importa.
*/

const valido = {
  rendaMensal: 2500,
  tipoRenda: "clt",
  idade: 22,
  moradia: "pais",
  custoMoradia: 0,
  gastosFixos: gastos(900),
  dividas: [],
  guardado: 0,
};

function erros(dados: unknown): Record<string, string> {
  const r = validarPerfil(dados);
  expect(r.ok).toBe(false);
  return r.ok ? {} : r.erros;
}

describe("validarPerfil — válido", () => {
  it("aceita o perfil da persona e devolve os dados iguais", () => {
    const r = validarPerfil(valido);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.perfil).toEqual(valido);
  });

  it("aceita dívidas com e sem campos opcionais", () => {
    const r = validarPerfil({
      ...valido,
      dividas: [
        { tipo: "rotativo", saldo: 1500 },
        { tipo: "financiamento", saldo: 20000, parcela: 450, taxaAnual: 0.22 },
        { tipo: "outra", saldo: 100, parcela: 0, taxaAnual: 0 },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("aceita exatamente MAX_DIVIDAS dívidas", () => {
    const dividas = Array.from({ length: MAX_DIVIDAS }, () => ({ tipo: "outra", saldo: 10 }));
    expect(validarPerfil({ ...valido, dividas }).ok).toBe(true);
  });

  it("aceita todos os enums exportados", () => {
    for (const tipoRenda of TIPOS_RENDA) expect(validarPerfil({ ...valido, tipoRenda }).ok).toBe(true);
    for (const moradia of MORADIAS) expect(validarPerfil({ ...valido, moradia }).ok).toBe(true);
    for (const tipo of TIPOS_DIVIDA) {
      expect(validarPerfil({ ...valido, dividas: [{ tipo, saldo: 1 }] }).ok).toBe(true);
    }
    for (const m of MORADIAS_SEM_CUSTO) expect(MORADIAS).toContain(m);
  });
});

describe("validarPerfil — erros por campo, em pt-BR", () => {
  it("renda negativa", () => {
    expect(erros({ ...valido, rendaMensal: -100 }).rendaMensal).toBe("A renda precisa ser maior que zero");
  });

  it("renda zero também não vale", () => {
    expect(erros({ ...valido, rendaMensal: 0 }).rendaMensal).toBe("A renda precisa ser maior que zero");
  });

  it("renda ausente", () => {
    const { rendaMensal: _omitida, ...semRenda } = valido;
    void _omitida;
    expect(erros(semRenda).rendaMensal).toBe("Informe quanto entra por mês");
  });

  it("renda como texto não passa", () => {
    expect(erros({ ...valido, rendaMensal: "2500" }).rendaMensal).toBe("Informe quanto entra por mês");
  });

  it("idade fracionária", () => {
    expect(erros({ ...valido, idade: 22.5 }).idade).toBe("Idade em anos inteiros");
  });

  it("idade fora da faixa", () => {
    expect(erros({ ...valido, idade: 12 }).idade).toBe("A partir de 14 anos");
    expect(erros({ ...valido, idade: 130 }).idade).toBe("Confere a idade?");
  });

  it("mais de MAX_DIVIDAS", () => {
    const dividas = Array.from({ length: MAX_DIVIDAS + 1 }, () => ({ tipo: "outra", saldo: 10 }));
    expect(erros({ ...valido, dividas }).dividas).toBe(`No máximo ${MAX_DIVIDAS} dívidas`);
  });

  it("dívida com saldo 0 → mensagem mapeada em dividas.N.saldo", () => {
    const e = erros({ ...valido, dividas: [{ tipo: "rotativo", saldo: 0 }] });
    expect(e["dividas.0.saldo"]).toBe("O saldo precisa ser maior que zero");
    expect(Object.keys(e)).toEqual(["dividas.0.saldo"]);
  });

  it("erros em dívidas diferentes ficam em caminhos diferentes", () => {
    const e = erros({
      ...valido,
      dividas: [
        { tipo: "rotativo", saldo: 100, parcela: -1 },
        { tipo: "banco_x", saldo: 100 },
        { tipo: "outra", saldo: 100, taxaAnual: 25 },
      ],
    });
    expect(e["dividas.0.parcela"]).toBe("A parcela não pode ser negativa");
    expect(e["dividas.1.tipo"]).toBe("Escolha o tipo da dívida");
    expect(e["dividas.2.taxaAnual"]).toBe("Taxa acima de 2.000% ao ano? Confere o valor");
  });

  it("enums inválidos", () => {
    expect(erros({ ...valido, tipoRenda: "autonomo" }).tipoRenda).toBe("Escolha como é a sua renda");
    expect(erros({ ...valido, moradia: "barco" }).moradia).toBe("Escolha onde você mora");
  });

  it("custos e guardado negativos", () => {
    const e = erros({ ...valido, custoMoradia: -1, guardado: -1 });
    expect(e.custoMoradia).toBe("Não pode ser negativo");
    expect(e.guardado).toBe("Não pode ser negativo");
  });

  describe("gastos fixos", () => {
    it("categoria fora do catálogo", () => {
      const e = erros({ ...valido, gastosFixos: [{ categoria: "jatinho", valor: 100 }] });
      expect(e["gastosFixos.0.categoria"]).toBe("Categoria desconhecida");
    });

    it("valor zero ou negativo não é gasto", () => {
      expect(erros({ ...valido, gastosFixos: [{ categoria: "mercado", valor: 0 }] })["gastosFixos.0.valor"]).toBe(
        "O valor precisa ser maior que zero",
      );
      expect(erros({ ...valido, gastosFixos: [{ categoria: "mercado", valor: -5 }] })["gastosFixos.0.valor"]).toBe(
        "O valor precisa ser maior que zero",
      );
    });

    it("categoria livre exige nome", () => {
      const e = erros({ ...valido, gastosFixos: [{ categoria: "outro", valor: 80 }] });
      expect(e["gastosFixos.0.nome"]).toBe("Dê um nome pra esse gasto");
    });

    it("categoria livre com nome passa", () => {
      const r = validarPerfil({
        ...valido,
        gastosFixos: [{ categoria: "outro", nome: "Mensalidade do clube", valor: 80 }],
      });
      expect(r.ok).toBe(true);
    });

    it("nome longo demais", () => {
      const e = erros({
        ...valido,
        gastosFixos: [{ categoria: "outro", nome: "x".repeat(41), valor: 80 }],
      });
      expect(e["gastosFixos.0.nome"]).toBe("No máximo 40 caracteres");
    });

    it("acima do teto de linhas", () => {
      const muitos = Array.from({ length: MAX_GASTOS_FIXOS + 1 }, () => ({
        categoria: "mercado",
        valor: 10,
      }));
      expect(erros({ ...valido, gastosFixos: muitos }).gastosFixos).toBe(
        `No máximo ${MAX_GASTOS_FIXOS} gastos fixos`,
      );
    });

    it("lista vazia é válida: dá pra não ter gasto fixo nenhum", () => {
      expect(validarPerfil({ ...valido, gastosFixos: [] }).ok).toBe(true);
    });
  });

  it("guardado ausente pede o valor (pode ser 0)", () => {
    const { guardado: _omitido, ...semGuardado } = valido;
    void _omitido;
    expect(erros(semGuardado).guardado).toBe("Informe quanto você tem guardado (pode ser 0)");
  });

  it("primeiro erro de cada campo prevalece", () => {
    // idade 130.5 viola int (declarado primeiro) e max ao mesmo tempo: só a primeira mensagem chega à tela.
    // (zod 4 para os checks depois de int falhar, então o schema nunca produz duas issues no mesmo caminho;
    // o mapa de erros ainda garante uma mensagem por campo, e é sempre a primeira.)
    for (const idade of [10.5, 130.5]) {
      const r = perfilSchema.safeParse({ ...valido, idade });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.map((i) => i.path.join("."))).toEqual(["idade"]);
        expect(r.error.issues[0].message).toBe("Idade em anos inteiros");
      }
      const e = erros({ ...valido, idade });
      expect(Object.keys(e)).toEqual(["idade"]);
      expect(e.idade).toBe("Idade em anos inteiros");
      expect(e.idade).not.toBe("Confere a idade?");
    }
  });

  it("vários campos errados → um erro por campo, sem perder nenhum", () => {
    const e = erros({ ...valido, rendaMensal: -1, idade: 3.3, tipoRenda: "x" });
    expect(Object.keys(e).sort()).toEqual(["idade", "rendaMensal", "tipoRenda"]);
  });

  it("entrada que não é objeto vira erro na raiz", () => {
    const e = erros(null);
    expect(Object.keys(e)).toEqual(["_"]);
    expect(typeof e._).toBe("string");
  });
});
