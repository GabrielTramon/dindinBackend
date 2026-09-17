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
export { gerarPlano, avaliarDividas, detalharGastos, simularQuitacao, taxaMensal } from "./motor";
export type { OpcoesMotor, Cronograma } from "./motor";
export { projetarSaldo, mesesParaMeta, aporteParaMeta, serieProjecao } from "./projecao";
export type { ParametrosProjecao, PontoProjecao } from "./projecao";
export {
  perfilSchema,
  dividaSchema,
  gastoFixoSchema,
  validarPerfil,
  TIPOS_RENDA,
  MORADIAS,
  MORADIAS_SEM_CUSTO,
  TIPOS_DIVIDA,
} from "./schema";
export type { PerfilInput, PerfilValidado } from "./schema";
export { NOME_DIVIDA, ROTULO_DIVIDA, ROTULO_DEGRAU } from "./textos";
