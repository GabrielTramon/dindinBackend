import type { TipoDivida } from '../../dividas';
import type { DadosPerfil } from '../../perfil';
import type { PerfilDoMotor, PlanoDoMotor } from '../../planos';

/*
  O que a pessoa recebe quando pede "exportar meus dados" (LGPD, portabilidade):
  tudo que o dindin guarda sobre ela, com os nomes que ela vê na tela.

  Fica de fora, de propósito:
  - ids: são chaves do banco e não dizem nada pra pessoa. O gasto aponta pra
    categoria pelo nome, e o plano e o check-in já se identificam pela versão e
    pela competência. Vale também pro id que veio do cliente (grupos, itens e
    os potes da meta — estes em todo lugar onde a meta aparece: no perfil e na
    entrada e no resultado de cada versão do plano);
  - hash da senha (nem se ela existe) e hash e validade do link do e-mail:
    segredo de autenticação, não dado útil;
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

type MetaDoPerfil = NonNullable<DadosPerfil['meta']>;

/*
  Um pote do que a pessoa já tem guardado pra meta (meta.guardados), sem o id:
  como o dos grupos, veio do cliente (é o do localStorage) e é chave, não
  informação — o pote se identifica pelo nome e pela ordem.
*/
export type PoteExportado = Omit<NonNullable<MetaDoPerfil['guardados']>[number], 'id'>;

/** A meta do perfil no arquivo: a mesma, com os potes sem id. */
export type MetaDoPerfilExportada = Omit<MetaDoPerfil, 'guardados'> & { guardados?: PoteExportado[] };

/**
 * Qualquer coisa que carrega a meta do perfil — as respostas, a entrada de uma
 * versão do plano, o perfil que o plano devolve dentro dele —, com os potes sem id.
 */
export type ComMetaExportada<T extends { meta?: MetaDoPerfil }> = Omit<T, 'meta'> & { meta?: MetaDoPerfilExportada };

export interface PerfilExportado extends ComMetaExportada<DadosPerfil> {
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
  /** o perfil que entrou no motor (os potes da meta sem id, como no perfil) */
  entrada: ComMetaExportada<PerfilDoMotor>;
  resultado: Omit<PlanoDoMotor, 'perfil'> & { perfil: ComMetaExportada<PerfilDoMotor> };
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

export interface ItemGrupoExportado {
  nome: string;
  valor: number;
}

/*
  A árvore da organização do excedente. O id do grupo e do item FICA DE FORA como
  todo id: aqui ele veio do cliente (é o do localStorage), mas continua sendo
  chave, não informação — a árvore já se identifica pelo nome e pela ordem.

  `rendimentoMensal` é a fração ao mês que a pessoa digitou (0.008 = 0,8%) e é
  `null` quando o grupo não rende: no arquivo, ausente e "não rende" são a mesma
  coisa, e `null` é mais legível do que a chave sumir no meio da lista.
*/
export interface GrupoExportado {
  nome: string;
  icone: string;
  valor: number;
  contaParaMeta: boolean;
  rendimentoMensal: number | null;
  /** o "Guardar" que o plano preenche */
  doSistema: boolean;
  criadoEm: Date;
  /** na ordem em que a pessoa organizou */
  itens: ItemGrupoExportado[];
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
  /** a árvore do excedente, na ordem em que a pessoa organizou */
  grupos: GrupoExportado[];
}
