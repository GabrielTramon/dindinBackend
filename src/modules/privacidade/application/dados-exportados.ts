import type { TipoDivida } from '../../dividas';
import type { DadosPerfil } from '../../perfil';
import type { PerfilDoMotor, PlanoDoMotor } from '../../planos';

/*
  O que a pessoa recebe quando pede "exportar meus dados" (LGPD, portabilidade):
  tudo que o dindin guarda sobre ela, com os nomes que ela vê na tela.

  Fica de fora, de propósito:
  - ids: são chaves do banco e não dizem nada pra pessoa. O gasto aponta pra
    categoria pelo nome, e o plano e o check-in já se identificam pela versão e
    pela competência;
  - hash e validade do link mágico: segredo de autenticação, não dado útil;
  - qualquer coisa de outra pessoa. O catálogo de categorias é de todo mundo e
    só aparece como o nome da categoria de um gasto.

  As datas são Date aqui; o presenter converte pra ISO na hora de montar o arquivo.
*/

export interface ContaExportada {
  email: string;
  criadoEm: Date;
  emailVerificadoEm: Date | null;
  ativo: boolean;
}

export interface PerfilExportado extends DadosPerfil {
  atualizadoEm: Date;
}

export interface GastoFixoExportado {
  /** nome da categoria (do catálogo ou personalizada) */
  categoria: string;
  valor: number;
  criadoEm: Date;
}

export interface CategoriaPersonalizadaExportada {
  nome: string;
  criadoEm: Date;
}

export interface DividaExportada {
  tipo: TipoDivida;
  saldo: number;
  parcela: number | null;
  taxaAnual: number | null;
  criadoEm: Date;
}

export interface VersaoPlanoExportada {
  versao: number;
  criadoEm: Date;
  /** o perfil que entrou no motor */
  entrada: PerfilDoMotor;
  resultado: PlanoDoMotor;
}

export interface MetaExportada {
  nome: string;
  valorAlvo: number;
  aporteMensal: number | null;
  prazoMeses: number | null;
  acumulado: number;
  /** endereço público que a própria pessoa escolheu publicar; null quando não publicou */
  publicSlug: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface CheckInExportado {
  competencia: string;
  rendaReal: number | null;
  gastoReal: number | null;
  guardadoReal: number | null;
  enviadoEm: Date | null;
  respondidoEm: Date | null;
  criadoEm: Date;
}

export interface DadosExportados {
  exportadoEm: Date;
  conta: ContaExportada;
  /** null quando a pessoa ainda não respondeu o perfil */
  perfil: PerfilExportado | null;
  /** do maior valor pro menor, como na tela */
  gastosFixos: GastoFixoExportado[];
  categoriasPersonalizadas: CategoriaPersonalizadaExportada[];
  /** ordem de criação */
  dividas: DividaExportada[];
  /** todas as versões, da mais nova pra mais antiga */
  planos: VersaoPlanoExportada[];
  /** da mais recente pra mais antiga */
  metas: MetaExportada[];
  /** todos os meses, do mais recente pro mais antigo */
  checkIns: CheckInExportado[];
}
