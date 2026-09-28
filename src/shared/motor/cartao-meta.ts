/*
  GERADO a partir de dindinFrontend/src/domain/cartao-meta.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

import { mesEstimado, type MetaNoCaminho } from "./marcos";
import { ICONE_META_PADRAO, METAS, rotuloMeta } from "./metas-catalogo";
import type { Meta } from "./types";
import { arredondar, formatBRL, formatMeses } from "./format";

/*
  O cartão "Sua meta": a meta à vista, em qualquer passo do plano.

  O cartão do topo fala do passo de AGORA (fôlego, dívida, reserva…), e o
  prazo dele não é o da meta — com a meta só no "Seu caminho", quem olhava
  "Montar seu fôlego · por 1 mês" lia "1 mês pra juntar R$ 50.000". Aqui a
  meta tem o lugar dela: quanto já tem, quanto falta, quando chega e como.

  Os números são os da MESMA projeção do caminho (`caminhoDoPlano(...).meta`):
  o cartão, o caminho e "Sua meta" nos detalhes nunca discordam.

  Puro: sem React, sem I/O; `hoje` entra por parâmetro.
*/

export interface CartaoMeta {
  /** "Liberdade financeira" */
  nome: string;
  /** ícone do lucide, do catálogo de metas */
  icone: string;
  valorAlvo: number;
  /** o que já está guardado pra ela, nunca mais que o alvo */
  jaTem: number;
  /** % do caminho já feito (0 a 100, pra baixo: 99,6% ainda não é 100%) */
  pct: number;
  estado: "prazo" | "garantida" | "sem-prazo";
  /** "Chega em 8 meses" / "Já garantida" / "Não fecha nesse ritmo" */
  titulo: string;
  /** "maio de 2027"; null sem prazo */
  mes: string | null;
  /** como ela chega lá, numa frase */
  como: string;
  /** o cartão inteiro numa frase, pro leitor de tela */
  rotuloSr: string;
}

function comoChega(noCaminho: MetaNoCaminho, hoje: Date): string {
  const { projecao, inicio, aporteDoPlano } = noCaminho;
  const ja = projecao.jaGuardado;
  const potes = arredondar(Math.max(0, projecao.aporteMensal - aporteDoPlano));
  const base = ja > 0 ? `Começa com ${formatBRL(ja)} já guardados, rendendo,` : "Começa do zero";

  let mensal: string;
  if (aporteDoPlano > 0 && inicio !== null && inicio > 0) {
    const quando = mesEstimado(hoje, inicio + 1);
    mensal = `recebe ${formatBRL(aporteDoPlano)} por mês${quando ? ` a partir de ${quando}` : ""}${potes > 0 ? ` (e ${formatBRL(potes)} dos potes desde já)` : ""}`;
  } else if (aporteDoPlano > 0) {
    mensal = `recebe ${formatBRL(arredondar(aporteDoPlano + potes))} por mês`;
  } else if (potes > 0) {
    mensal = `recebe ${formatBRL(potes)} por mês dos potes${inicio === null ? "; o que o plano guarda entra quando os passos de antes tiverem prazo" : ""}`;
  } else {
    mensal = "nada entra por mês ainda";
  }
  // o 13º entra no prazo lá em cima: sem ele aqui, "R$ 300 por mês" não explicaria o mês
  const decimo = noCaminho.decimoPorAno ? `, mais o 13º (${formatBRL(noCaminho.decimoPorAno)}) todo dezembro` : "";
  return `${base} e ${mensal}${decimo}.`;
}

export function cartaoDaMeta(meta: Meta, noCaminho: MetaNoCaminho, hoje: Date): CartaoMeta {
  const { projecao } = noCaminho;
  const nome = rotuloMeta(meta);
  const icone = METAS.find((m) => m.slug === meta.tipo)?.icone ?? ICONE_META_PADRAO;
  const valorAlvo = projecao.valorAlvo;
  const jaTem = Math.min(projecao.jaGuardado, valorAlvo);
  const pct = valorAlvo > 0 ? Math.min(100, Math.floor((jaTem / valorAlvo) * 100)) : 0;
  const base = { nome, icone, valorAlvo, jaTem, pct };

  if (projecao.meses === 0) {
    return {
      ...base,
      pct: 100,
      estado: "garantida",
      titulo: "Já garantida",
      mes: null,
      como: `O que você já guardou pra ela (${formatBRL(projecao.jaGuardado)}) cobre o valor inteiro.`,
      rotuloSr: `Sua meta, ${nome}, de ${formatBRL(valorAlvo)}: já garantida com o que você guardou.`,
    };
  }

  if (projecao.meses === null) {
    return {
      ...base,
      estado: "sem-prazo",
      titulo: "Não fecha nesse ritmo",
      mes: null,
      como: `${comoChega(noCaminho, hoje)} Guarde uma fatia maior, some um pote a ela ou reveja o valor.`,
      rotuloSr: `Sua meta, ${nome}, de ${formatBRL(valorAlvo)}: já tem ${formatBRL(jaTem)}; não fecha nesse ritmo.`,
    };
  }

  const titulo = `Chega em ${formatMeses(projecao.meses)}`;
  return {
    ...base,
    estado: "prazo",
    titulo,
    mes: projecao.mesEstimado,
    como: comoChega(noCaminho, hoje),
    rotuloSr: `Sua meta, ${nome}, de ${formatBRL(valorAlvo)}: já tem ${formatBRL(jaTem)}, ${pct}%. ${titulo}${projecao.mesEstimado ? `, em ${projecao.mesEstimado}` : ""}.`,
  };
}
