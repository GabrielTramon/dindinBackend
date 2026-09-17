import { TAXA_LIVRE_RISCO_ANUAL } from '../../../shared/motor/config';
import { arredondar } from '../../../shared/motor/format';
import { aporteParaMeta, mesesParaMeta } from '../../../shared/motor/projecao';
import type { Meta } from '../domain/meta';

/*
  Projeção de uma meta: o que o dindin calcula a partir do que a pessoa informou.
  Não é persistida — muda com o tempo (agora) e com a taxa — e os juros vêm do
  motor, as mesmas contas que o simulador do frontend faz.

  - com aporte mensal: em quantos meses chega (null = não chega em 100 anos);
    aporteNecessario fica null, porque o aporte é o que a pessoa já informou;
  - com prazo: quanto guardar por mês pra chegar no prazo; mesesEstimados é o prazo;
  - atingida: 0 meses e aporte 0, nos dois modos.
*/

/** O mês estimado é o do calendário de quem usa o produto, não o do servidor. */
const FUSO_DO_PRODUTO = 'America/Sao_Paulo';

export interface ProjecaoMeta {
  /** quanto falta pro alvo, em reais; 0 quando atingida */
  faltante: number;
  /** aporte mensal pra chegar no prazo; null quando a meta é por aporte */
  aporteNecessario: number | null;
  /** null quando o aporte informado não chega no alvo em 100 anos */
  mesesEstimados: number | null;
  /** "AAAA-MM" em que a meta deve ser atingida; null quando nunca */
  mesEstimado: string | null;
}

export interface MetaComProjecao {
  meta: Meta;
  projecao: ProjecaoMeta;
}

/** "AAAA-MM" de `agora` somado a `meses`, contando o mês no fuso do produto. */
export function mesDaqui(agora: Date, meses: number, timeZone = FUSO_DO_PRODUTO): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(agora);
  const ano = Number(partes.find((p) => p.type === 'year')?.value);
  const mes = Number(partes.find((p) => p.type === 'month')?.value);
  const total = ano * 12 + (mes - 1) + meses;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function projetarMeta(meta: Meta, agora: Date, taxaAnual = TAXA_LIVRE_RISCO_ANUAL): ProjecaoMeta {
  if (meta.atingida) {
    return { faltante: 0, aporteNecessario: 0, mesesEstimados: 0, mesEstimado: mesDaqui(agora, 0) };
  }
  // os dois têm no máximo 2 casas; a subtração em ponto flutuante não (10000 − 9999,99 = 0,0100000000002)
  const faltante = Math.max(0, arredondar(meta.valorAlvo - meta.acumulado));

  if (meta.aporteMensal !== null) {
    const parametros = { saldoInicial: meta.acumulado, aporteMensal: meta.aporteMensal, taxaAnual };
    const meses = mesesParaMeta(parametros, meta.valorAlvo);
    return {
      faltante,
      aporteNecessario: null,
      mesesEstimados: meses,
      mesEstimado: meses === null ? null : mesDaqui(agora, meses),
    };
  }

  if (meta.prazoMeses !== null) {
    return {
      faltante,
      aporteNecessario: aporteParaMeta(meta.valorAlvo, meta.prazoMeses, { saldoInicial: meta.acumulado, taxaAnual }),
      mesesEstimados: meta.prazoMeses,
      mesEstimado: mesDaqui(agora, meta.prazoMeses),
    };
  }

  // a entidade não deixa gravar sem aporte nem prazo; se uma linha assim vier do banco, não inventa número
  return { faltante, aporteNecessario: null, mesesEstimados: null, mesEstimado: null };
}

export function comProjecao(meta: Meta, agora: Date, taxaAnual = TAXA_LIVRE_RISCO_ANUAL): MetaComProjecao {
  return { meta, projecao: projetarMeta(meta, agora, taxaAnual) };
}
