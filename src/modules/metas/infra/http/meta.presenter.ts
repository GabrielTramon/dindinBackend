import type { MetaPublica } from '../../application/obter-meta-publica.use-case';
import type { MetaComProjecao } from '../../application/projecao-meta';

/** Meta como a dona vê. Não expõe o dono. */
export function presentMeta({ meta, projecao }: MetaComProjecao) {
  return {
    id: meta.id,
    nome: meta.nome,
    valorAlvo: meta.valorAlvo,
    aporteMensal: meta.aporteMensal,
    prazoMeses: meta.prazoMeses,
    acumulado: meta.acumulado,
    progresso: meta.progresso,
    atingida: meta.atingida,
    publicSlug: meta.publicSlug,
    projecao: {
      faltante: projecao.faltante,
      aporteNecessario: projecao.aporteNecessario,
      mesesEstimados: projecao.mesesEstimados,
      mesEstimado: projecao.mesEstimado,
    },
    criadoEm: meta.criadoEm.toISOString(),
    atualizadoEm: meta.atualizadoEm.toISOString(),
  };
}

export type MetaResponse = ReturnType<typeof presentMeta>;

/** Meta como qualquer pessoa vê pelo link: nome e percentual, nunca reais nem id. */
export function presentMetaPublica(meta: MetaPublica) {
  return {
    nome: meta.nome,
    progresso: meta.progresso,
    atingida: meta.atingida,
  };
}

export type MetaPublicaResponse = ReturnType<typeof presentMetaPublica>;
