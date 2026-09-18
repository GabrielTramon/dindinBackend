/*
  GERADO a partir de dindinFrontend/src/domain/index.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

export * from "./types";
export * from "./config";
export {
  CATEGORIAS,
  CATEGORIAS_DO_ONBOARDING,
  GRUPOS_DO_ONBOARDING,
  ICONE_PADRAO,
  ROTULO_GRUPO,
  SLUGS_CATEGORIA,
  SLUG_OUTRO,
  categoriaPorSlug,
} from "./categorias";
export type { Categoria, GrupoCategoria } from "./categorias";
export {
  gerarPlano,
  avaliarDividas,
  detalharGastos,
  simularQuitacao,
  simularQuitacaoDetalhada,
  taxaMensal,
} from "./motor";
export type { OpcoesMotor, Cronograma, ResultadoQuitacao } from "./motor";
export { projetarSaldo, mesesParaMeta, aporteParaMeta, serieProjecao } from "./projecao";
export type { ParametrosProjecao, PontoProjecao } from "./projecao";
export { calcularINSS, calcularIRRF, brutoParaLiquido } from "./renda";
export type { Holerite, DeducoesIRRF } from "./renda";
export {
  METAS,
  ICONE_META_PADRAO,
  metaPorTipo,
  rotuloMeta,
  GRUPOS_SUGERIDOS,
  ICONE_GRUPO_PADRAO,
  SLUG_GRUPO_SISTEMA,
  grupoSugeridoPorSlug,
  gruposSugeridosPara,
} from "./metas-catalogo";
export type { MetaCatalogo, GrupoSugerido } from "./metas-catalogo";
export {
  organizarExcedente,
  ajustarProporcionalmente,
  projetarMeta,
  podeAdicionarGrupo,
  podeAdicionarItem,
} from "./organizacao";
export type { Grupo, ItemGrupo, GrupoOrganizado, FatiaItem, Organizacao, ProjecaoMeta } from "./organizacao";
export {
  perfilSchema,
  dividaSchema,
  gastoFixoSchema,
  metaSchema,
  validarPerfil,
  TIPOS_RENDA,
  MORADIAS,
  MORADIAS_SEM_CUSTO,
  TIPOS_DIVIDA,
  RITMOS,
  RENDAS_INFORMADAS,
  METAS_TIPO,
} from "./schema";
export type { PerfilInput, PerfilValidado } from "./schema";
export { NOME_DIVIDA, ROTULO_DIVIDA, ROTULO_DEGRAU, ROTULO_RITMO } from "./textos";
