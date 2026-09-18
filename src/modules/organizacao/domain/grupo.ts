import { ConflictError } from '../../../shared/domain/errors';
import {
  ensure,
  ensureMoneyPrecision,
  hasAtMostDecimals,
  isValidMoney,
  normalizeName,
} from '../../../shared/domain/guards';
import { MAX_GRUPOS, MAX_ITENS_POR_GRUPO, MAX_RENDIMENTO_MENSAL } from '../../../shared/motor/config';
import { arredondar } from '../../../shared/motor/format';
import { ICONE_GRUPO_PADRAO } from '../../../shared/motor/metas-catalogo';

/*
  Um grupo do excedente, com os itens dentro dele — "Investimento: R$ 800, sendo
  R$ 300 em Viagem". O grupo é o agregado: item não existe fora de um grupo e não
  tem repositório próprio.

  O id vem do CLIENTE: é o mesmo do localStorage, e é o que faz a árvore
  sobreviver ao round-trip (PUT → GET) sem a tela perder de vista quem é quem.
  Por isso a chave primária no banco é composta com o dono — id de uma pessoa
  nunca colide com o de outra.

  O que esta entidade NÃO faz: conferir a soma contra a base (o excedente). A
  base vem do plano e muda a cada recálculo; quem calcula é o motor, no cliente.
  O servidor guarda o que a pessoa organizou — inclusive quando passou da base,
  que é um estado válido e só pinta de vermelho na tela.
*/

export { MAX_GRUPOS, MAX_ITENS_POR_GRUPO, MAX_RENDIMENTO_MENSAL };

/** Vale pro nome do grupo e pro nome do item: os dois cabem num cartão. */
export const TAMANHO_MAXIMO_NOME = 40;

/** Rendimento é fração ao mês (0,8% = 0.008) e a coluna é Decimal(6,4). */
export const CASAS_RENDIMENTO = 4;

export interface ItemGrupoProps {
  id: string;
  nome: string;
  valor: number;
  /** posicional: o índice em que o item chegou */
  ordem: number;
}

export interface GrupoProps {
  id: string;
  subscriberId: string;
  nome: string;
  /** nome do componente no lucide-react */
  icone: string;
  /** reais/mês; a % é derivada pelo motor, NUNCA gravada */
  valor: number;
  contaParaMeta: boolean;
  /** ausente = não rende; no domínio é sempre `undefined`, nunca `null` */
  rendimentoMensal?: number;
  /** o "Guardar" que a cascata preenche; no máximo um por pessoa */
  doSistema: boolean;
  /** posicional: o índice em que o grupo chegou */
  ordem: number;
  criadoEm: Date;
  itens: ItemGrupoProps[];
}

export interface ItemGrupoInput {
  id: string;
  nome: string;
  valor: number;
}

export interface CriarGrupoInput {
  id: string;
  subscriberId: string;
  nome: string;
  icone?: string;
  valor: number;
  contaParaMeta?: boolean;
  rendimentoMensal?: number;
  doSistema?: boolean;
  ordem: number;
  itens?: readonly ItemGrupoInput[];
  agora: Date;
}

const PORCENTAGEM_MAXIMA = arredondar(MAX_RENDIMENTO_MENSAL * 100);

// lucide-react: nome de componente, PascalCase sem espaço nem pontuação
const NOME_DE_ICONE = /^[A-Za-z][A-Za-z0-9]*$/;

function normalizarNome(nome: unknown, campo: string): string {
  ensure(typeof nome === 'string', campo, 'Dê um nome pro grupo');
  const normalizado = normalizeName(nome);
  ensure(normalizado.length > 0, campo, 'Dê um nome pro grupo');
  ensure(normalizado.length <= TAMANHO_MAXIMO_NOME, campo, `No máximo ${TAMANHO_MAXIMO_NOME} caracteres`);
  return normalizado;
}

/*
  O catálogo de ícones é fechado no CLIENTE (GRUPOS_SUGERIDOS), e o servidor
  confere só o FORMATO. Recusar um ícone que o app acabou de acrescentar faria o
  PUT responder 400 e a pessoa perder a organização inteira por causa de um
  desenho — enquanto o motor daqui ainda não tinha sido sincronizado. A tela já
  cai no ícone padrão quando não conhece o nome.
*/
function normalizarIcone(icone: string | undefined, campo: string): string {
  if (icone === undefined) return ICONE_GRUPO_PADRAO;
  const normalizado = icone.trim();
  if (normalizado.length === 0) return ICONE_GRUPO_PADRAO;
  ensure(normalizado.length <= TAMANHO_MAXIMO_NOME && NOME_DE_ICONE.test(normalizado), campo, 'Ícone inválido');
  return normalizado;
}

/*
  Dinheiro do grupo e do item: zero é válido (grupo recém-criado, item ainda sem
  valor), negativo não. `isValidMoney` cobre o teto do Decimal(12,2) e
  `ensureMoneyPrecision` as 2 casas — nunca Math.round(v * 100), que recusava
  R$ 19,99 por erro de ponto flutuante.
*/
function validarValor(valor: unknown, campo: string): number {
  ensure(typeof valor === 'number' && Number.isFinite(valor), campo, 'Informe um valor em reais');
  ensure(valor >= 0, campo, 'O valor não pode ser negativo');
  ensureMoneyPrecision(valor, campo);
  ensure(isValidMoney(valor, { allowZero: true }), campo, 'Confere esse valor? Está muito alto');
  return valor;
}

function validarRendimento(rendimento: number, campo: string): number {
  ensure(Number.isFinite(rendimento), campo, 'Informe o rendimento ao mês');
  ensure(rendimento >= 0, campo, 'O rendimento não pode ser negativo');
  ensure(rendimento <= MAX_RENDIMENTO_MENSAL, campo, `O rendimento vai até ${PORCENTAGEM_MAXIMA}% ao mês`);
  ensure(hasAtMostDecimals(rendimento, CASAS_RENDIMENTO), campo, `No máximo ${CASAS_RENDIMENTO} casas decimais`);
  return rendimento;
}

function validarItens(itens: readonly ItemGrupoInput[], valorDoGrupo: number): ItemGrupoProps[] {
  ensure(itens.length <= MAX_ITENS_POR_GRUPO, 'itens', `No máximo ${MAX_ITENS_POR_GRUPO} itens por grupo`);

  const vistos = new Set<string>();
  const validados = itens.map((item, i) => {
    ensure(typeof item?.id === 'string' && item.id.length > 0, `itens.${i}.id`, 'Identificador inválido');
    // a chave primária é (subscriber_id, grupo_id, id): id repetido dentro do grupo não
    // pode virar "o último vence" — a pessoa perderia um item sem nenhum aviso
    ensure(!vistos.has(item.id), `itens.${i}.id`, 'Esse item aparece duas vezes');
    vistos.add(item.id);
    return {
      id: item.id,
      nome: normalizarNome(item.nome, `itens.${i}.nome`),
      valor: validarValor(item.valor, `itens.${i}.valor`),
      ordem: i,
    };
  });

  /*
    Cada item já tem no máximo 2 casas, então `arredondar` na soma devolve o
    total exato (0,1 + 0,2 = 0,30000000000000004 sem ele). Item não pode estourar
    o grupo: o "restante do grupo" que a tela mostra ficaria negativo.
  */
  const soma = arredondar(validados.reduce((total, item) => total + item.valor, 0));
  ensure(soma <= valorDoGrupo, 'itens', 'A soma dos itens passou do valor do grupo');

  return validados;
}

/*
  A chave `rendimentoMensal` só EXISTE quando há rendimento. No domínio, campo
  opcional é sempre `undefined` — nunca `null` —, e o snapshot omite a chave:
  assim o que volta no GET é igual ao que entrou no PUT, e `undefined` não vira
  `null` no meio do caminho.
*/
function montar(props: GrupoProps): GrupoProps {
  const { rendimentoMensal, ...resto } = props;
  return rendimentoMensal === undefined ? resto : { ...resto, rendimentoMensal };
}

export class Grupo {
  private constructor(private props: GrupoProps) {}

  /** Valida tudo o que o servidor guarda; a base (o excedente) não é da conta dele. */
  static criar(input: CriarGrupoInput): Grupo {
    const valor = validarValor(input.valor, 'valor');
    return new Grupo(
      montar({
        id: input.id,
        subscriberId: input.subscriberId,
        nome: normalizarNome(input.nome, 'nome'),
        icone: normalizarIcone(input.icone, 'icone'),
        valor,
        contaParaMeta: input.contaParaMeta ?? false,
        ...(input.rendimentoMensal !== undefined
          ? { rendimentoMensal: validarRendimento(input.rendimentoMensal, 'rendimentoMensal') }
          : {}),
        doSistema: input.doSistema ?? false,
        ordem: input.ordem,
        criadoEm: input.agora,
        itens: validarItens(input.itens ?? [], valor),
      }),
    );
  }

  /** Reconstrói do banco, sem validar. */
  static restaurar(props: GrupoProps): Grupo {
    return new Grupo(structuredClone(montar(props)));
  }

  get id() { return this.props.id; }
  get subscriberId() { return this.props.subscriberId; }
  get nome() { return this.props.nome; }
  get icone() { return this.props.icone; }
  get valor() { return this.props.valor; }
  get contaParaMeta() { return this.props.contaParaMeta; }
  get rendimentoMensal() { return this.props.rendimentoMensal; }
  get doSistema() { return this.props.doSistema; }
  get ordem() { return this.props.ordem; }
  get criadoEm() { return this.props.criadoEm; }

  /** Cópia: mexer no que sai daqui não altera o grupo. */
  get itens(): readonly ItemGrupoProps[] {
    return structuredClone(this.props.itens);
  }

  pertenceA(subscriberId: string): boolean {
    return this.props.subscriberId === subscriberId;
  }

  toSnapshot(): GrupoProps {
    return structuredClone(this.props);
  }
}

/**
 * As regras da ÁRVORE inteira, que nenhum grupo sozinho consegue conferir.
 *
 * @throws ValidationError
 */
export function validarOrganizacao(grupos: readonly Grupo[]): void {
  ensure(grupos.length <= MAX_GRUPOS, 'grupos', `No máximo ${MAX_GRUPOS} grupos — o "Guardar" conta`);

  const vistos = new Set<string>();
  grupos.forEach((grupo, i) => {
    // a chave primária é (subscriber_id, id): id repetido não é "o último vence",
    // é corpo malformado — gravar em silêncio sumiria com um grupo da tela
    ensure(!vistos.has(grupo.id), `grupos.${i}.id`, 'Esse grupo aparece duas vezes');
    vistos.add(grupo.id);
  });

  const doSistema = grupos.filter((grupo) => grupo.doSistema).length;
  ensure(doSistema <= 1, 'grupos', 'Só existe um grupo do sistema (o "Guardar")');
}

/** Chave primária composta repetida — em memória é emulado, no Prisma vem do banco. */
export function grupoRepetido(): ConflictError {
  return new ConflictError('Essa organização tem dois grupos com o mesmo identificador.', {
    grupos: 'Identificador repetido',
  });
}

/** O mesmo, dentro de um grupo. */
export function itemRepetido(): ConflictError {
  return new ConflictError('Esse grupo tem dois itens com o mesmo identificador.', {
    itens: 'Identificador repetido',
  });
}

/**
 * `replaceAll` grava a árvore de UMA pessoa. Grupo de outro dono na lista é
 * defeito de quem chamou: gravar trocaria o dono em silêncio, então falha alto (500).
 */
export function garantirMesmoDono(subscriberId: string, grupos: readonly { id: string; subscriberId: string }[]): void {
  const alheio = grupos.find((grupo) => grupo.subscriberId !== subscriberId);
  if (alheio) throw new Error(`replaceAll(${subscriberId}) recebeu o grupo ${alheio.id}, que é de outra pessoa`);
}
