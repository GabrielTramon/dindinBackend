import { avaliarDividas } from '../../../../shared/motor/motor';
import type { ClasseDivida, DividaAvaliada, TipoDivida } from '../../../../shared/motor/types';
import type { Divida } from '../../domain/divida';

/*
  Dívida como o cliente vê: o que a pessoa informou (taxaAnual pode ser null) e
  como o motor enxerga a dívida (taxa efetivamente usada, classe, juros do mês).
  A regra é do motor (taxa padrão do tipo, limiares de cara, média e barata); aqui
  só se casa o resultado com cada dívida. Não expõe o dono.
*/

export interface DividaResponse {
  id: string;
  tipo: TipoDivida;
  saldo: number;
  parcela: number | null;
  taxaAnual: number | null;
  taxaAnualUsada: number;
  classe: ClasseDivida;
  jurosMensais: number;
  criadoEm: string;
}

/**
 * O motor devolve objetos novos, ordenados da mais cara pra mais barata: a posição
 * não casa com a entrada. O id vai junto em cada item e volta no espalhamento
 * que o motor faz da dívida recebida.
 */
function avaliacoesPorId(dividas: readonly Divida[]): Map<string, DividaAvaliada> {
  const entrada = dividas.map((d) => ({
    id: d.id,
    tipo: d.tipo,
    saldo: d.saldo,
    ...(d.parcela !== null ? { parcela: d.parcela } : {}),
    ...(d.taxaAnual !== null ? { taxaAnual: d.taxaAnual } : {}),
  }));
  const porId = new Map<string, DividaAvaliada>();
  for (const avaliada of avaliarDividas(entrada)) {
    if ('id' in avaliada && typeof avaliada.id === 'string') porId.set(avaliada.id, avaliada);
  }
  return porId;
}

export function presentDividas(dividas: readonly Divida[]): DividaResponse[] {
  const avaliacoes = avaliacoesPorId(dividas);
  return dividas.map((divida) => {
    const avaliada = avaliacoes.get(divida.id);
    // o motor só descarta saldo zerado, e a entidade não deixa saldo zerado existir: faltar é defeito
    if (!avaliada) throw new Error(`Dívida ${divida.id} ficou fora da avaliação do motor`);
    return {
      id: divida.id,
      tipo: divida.tipo,
      saldo: divida.saldo,
      parcela: divida.parcela,
      taxaAnual: divida.taxaAnual,
      taxaAnualUsada: avaliada.taxaAnual,
      classe: avaliada.classe,
      jurosMensais: avaliada.jurosMensais,
      criadoEm: divida.criadoEm.toISOString(),
    };
  });
}

export function presentDivida(divida: Divida): DividaResponse {
  const [apresentada] = presentDividas([divida]);
  if (!apresentada) throw new Error(`Dívida ${divida.id} não foi apresentada`);
  return apresentada;
}
