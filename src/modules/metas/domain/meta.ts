import { BusinessRuleError } from '../../../shared/domain/errors';
import { ensure, isValidMoney, normalizeName } from '../../../shared/domain/guards';

/*
  Uma meta: "juntar 10 mil pra viagem". A pessoa informa o valor alvo e UM
  entre aporte mensal e prazo — o motor calcula o outro (projeção, não
  persistida). Informar os dois, ou nenhum, é erro: são duas formas de
  perguntar a mesma coisa.

  A meta pode virar pública (/meta/<slug>) pra compartilhar. A página pública
  mostra nome e percentual, nunca valores em reais.
*/

export const TAMANHO_MAXIMO_NOME_META = 60;
export const PRAZO_MAXIMO_MESES = 1200;
export const MAX_METAS = 20;

export interface DadosMeta {
  nome: string;
  valorAlvo: number;
  aporteMensal: number | null;
  prazoMeses: number | null;
  acumulado: number;
}

export interface MetaProps extends DadosMeta {
  id: string;
  subscriberId: string;
  publicSlug: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{2,48}[a-z0-9])$/;

function validar(dados: DadosMeta): DadosMeta {
  const nome = normalizeName(dados.nome);
  ensure(nome.length > 0, 'nome', 'Dê um nome pra meta');
  ensure(nome.length <= TAMANHO_MAXIMO_NOME_META, 'nome', `No máximo ${TAMANHO_MAXIMO_NOME_META} caracteres`);
  ensure(isValidMoney(dados.valorAlvo), 'valorAlvo', 'Informe um valor alvo maior que zero, com até 2 casas');
  ensure(isValidMoney(dados.acumulado, { allowZero: true }), 'acumulado', 'Informe o acumulado (pode ser 0), com até 2 casas');

  const temAporte = dados.aporteMensal !== null;
  const temPrazo = dados.prazoMeses !== null;
  if (temAporte === temPrazo) {
    throw new BusinessRuleError('Informe o aporte mensal ou o prazo — um dos dois, e o dindin calcula o outro.', {
      aporteMensal: 'Informe este ou o prazo',
      prazoMeses: 'Informe este ou o aporte mensal',
    });
  }
  if (dados.aporteMensal !== null) {
    ensure(isValidMoney(dados.aporteMensal), 'aporteMensal', 'Informe um aporte maior que zero, com até 2 casas');
  }
  if (dados.prazoMeses !== null) {
    ensure(
      Number.isInteger(dados.prazoMeses) && dados.prazoMeses >= 1 && dados.prazoMeses <= PRAZO_MAXIMO_MESES,
      'prazoMeses',
      `O prazo vai de 1 a ${PRAZO_MAXIMO_MESES} meses`,
    );
  }
  // campos montados um a um: espalhar `dados` deixava uma chave extra (id, subscriberId,
  // publicSlug) vinda do chamador sobrescrever o dono da meta no atualizar
  return {
    nome,
    valorAlvo: dados.valorAlvo,
    aporteMensal: dados.aporteMensal,
    prazoMeses: dados.prazoMeses,
    acumulado: dados.acumulado,
  };
}

export class Meta {
  private constructor(private props: MetaProps) {}

  static criar(input: {
    id: string;
    subscriberId: string;
    nome: string;
    valorAlvo: number;
    aporteMensal?: number | null;
    prazoMeses?: number | null;
    acumulado?: number;
    agora: Date;
  }): Meta {
    const dados = validar({
      nome: input.nome,
      valorAlvo: input.valorAlvo,
      aporteMensal: input.aporteMensal ?? null,
      prazoMeses: input.prazoMeses ?? null,
      acumulado: input.acumulado ?? 0,
    });
    return new Meta({
      ...dados,
      id: input.id,
      subscriberId: input.subscriberId,
      publicSlug: null,
      criadoEm: input.agora,
      atualizadoEm: input.agora,
    });
  }

  static restaurar(props: MetaProps): Meta {
    return new Meta(structuredClone(props));
  }

  get id() { return this.props.id; }
  get subscriberId() { return this.props.subscriberId; }
  get nome() { return this.props.nome; }
  get valorAlvo() { return this.props.valorAlvo; }
  get aporteMensal() { return this.props.aporteMensal; }
  get prazoMeses() { return this.props.prazoMeses; }
  get acumulado() { return this.props.acumulado; }
  get publicSlug() { return this.props.publicSlug; }
  get criadoEm() { return this.props.criadoEm; }
  get atualizadoEm() { return this.props.atualizadoEm; }

  get atingida(): boolean {
    return this.props.acumulado >= this.props.valorAlvo;
  }

  /** 0 a 1, truncado em 4 casas; só chega a 1 quando a meta foi atingida (arredondar mostraria 100% faltando R$ 0,01) */
  get progresso(): number {
    return Math.min(1, Math.floor((this.props.acumulado / this.props.valorAlvo) * 10_000) / 10_000);
  }

  /**
   * Campos ausentes ficam como estão. Pra trocar de aporte pra prazo, mande o
   * novo e `null` no outro — os dois juntos ou nenhum continua sendo erro.
   */
  atualizar(dados: Partial<DadosMeta>, agora: Date): void {
    const atual: DadosMeta = {
      nome: this.props.nome,
      valorAlvo: this.props.valorAlvo,
      aporteMensal: this.props.aporteMensal,
      prazoMeses: this.props.prazoMeses,
      acumulado: this.props.acumulado,
    };
    const definidos = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined));
    this.props = { ...this.props, ...validar({ ...atual, ...definidos }), atualizadoEm: agora };
  }

  publicar(slug: string, agora: Date): void {
    ensure(SLUG.test(slug), 'publicSlug', 'Endereço público inválido');
    this.props.publicSlug = slug;
    this.props.atualizadoEm = agora;
  }

  despublicar(agora: Date): void {
    if (this.props.publicSlug === null) return;
    this.props.publicSlug = null;
    this.props.atualizadoEm = agora;
  }

  toSnapshot(): MetaProps {
    return structuredClone(this.props);
  }
}
