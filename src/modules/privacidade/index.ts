// API pública do módulo privacidade: só contratos. Montagem (casos de uso, HTTP) fica em ./infra.
// O módulo não tem entidade nem repositório próprio: lê e apaga pelos repositórios dos outros módulos.
export { CONFIRMACAO_EXCLUSAO } from './application/excluir-conta.use-case';
export type {
  CategoriaPersonalizadaExportada,
  CheckInExportado,
  ContaExportada,
  DadosExportados,
  DividaExportada,
  GastoFixoExportado,
  MetaExportada,
  PerfilExportado,
  VersaoPlanoExportada,
} from './application/dados-exportados';
