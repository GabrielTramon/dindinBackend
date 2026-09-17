import { ensure, isValidMoney } from '../../../shared/domain/guards';

/*
  O check-in do mês: o que realmente aconteceu com o dinheiro. Um por
  subscriber por competência ("2026-09").

  Abrir (o job do dia 1), marcar como enviado (o e-mail saiu) e responder (a
  pessoa contou) são passos separados: dá pra saber quem recebeu e não
  respondeu. Responder de novo no mesmo mês corrige a resposta.

  QUAL MÊS: o job do dia 1 abre a competência do mês QUE ACABOU
  (competenciaAnterior(agora)) — a pergunta é "como foi setembro?" no dia 1º
  de outubro. Competência futura nunca é aceita, nem pra abrir nem pra responder;
  o mês corrente é aceito (a pessoa pode responder antes do e-mail chegar).
*/

export const FUSO_DO_PRODUTO = 'America/Sao_Paulo';

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function competenciaValida(competencia: string): boolean {
  const m = COMPETENCIA.exec(competencia);
  return m !== null && Number(m[1]) >= 2020 && Number(m[1]) <= 2100;
}

/**
 * O mês de uma data no fuso do Brasil. 02:00 UTC do dia 1 ainda é o mês
 * anterior em São Paulo — o job não pode abrir o mês errado.
 */
export function competenciaDe(data: Date, timeZone = FUSO_DO_PRODUTO): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(data);
  const ano = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  return `${ano}-${mes}`;
}

/** O mês anterior ao de `data`, no fuso do produto: o que o job do dia 1 abre. */
export function competenciaAnterior(data: Date, timeZone = FUSO_DO_PRODUTO): string {
  const [ano, mes] = competenciaDe(data, timeZone).split('-').map(Number) as [number, number];
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
}

function ensureNaoFutura(competencia: string, agora: Date): void {
  // "AAAA-MM" compara certo como texto
  ensure(competencia <= competenciaDe(agora), 'competencia', 'Esse mês ainda não chegou');
}

export interface RespostaCheckIn {
  rendaReal: number;
  gastoReal: number;
  guardadoReal: number;
}

export interface CheckInProps {
  id: string;
  subscriberId: string;
  competencia: string;
  rendaReal: number | null;
  gastoReal: number | null;
  guardadoReal: number | null;
  enviadoEm: Date | null;
  respondidoEm: Date | null;
  criadoEm: Date;
}

export class CheckIn {
  private constructor(private props: CheckInProps) {}

  static abrir(input: { id: string; subscriberId: string; competencia: string; agora: Date }): CheckIn {
    ensure(competenciaValida(input.competencia), 'competencia', 'Competência no formato AAAA-MM');
    ensureNaoFutura(input.competencia, input.agora);
    return new CheckIn({
      id: input.id,
      subscriberId: input.subscriberId,
      competencia: input.competencia,
      rendaReal: null,
      gastoReal: null,
      guardadoReal: null,
      enviadoEm: null,
      respondidoEm: null,
      criadoEm: input.agora,
    });
  }

  static restaurar(props: CheckInProps): CheckIn {
    return new CheckIn(structuredClone(props));
  }

  get id() { return this.props.id; }
  get subscriberId() { return this.props.subscriberId; }
  get competencia() { return this.props.competencia; }
  get rendaReal() { return this.props.rendaReal; }
  get gastoReal() { return this.props.gastoReal; }
  get guardadoReal() { return this.props.guardadoReal; }
  get enviadoEm() { return this.props.enviadoEm; }
  get respondidoEm() { return this.props.respondidoEm; }
  get criadoEm() { return this.props.criadoEm; }

  get respondido(): boolean {
    return this.props.respondidoEm !== null;
  }

  marcarEnviado(agora: Date): void {
    this.props.enviadoEm = agora;
  }

  responder(resposta: RespostaCheckIn, agora: Date): void {
    ensureNaoFutura(this.props.competencia, agora);
    ensure(isValidMoney(resposta.rendaReal, { allowZero: true }), 'rendaReal', 'Informe quanto entrou (pode ser 0)');
    ensure(isValidMoney(resposta.gastoReal, { allowZero: true }), 'gastoReal', 'Informe quanto saiu (pode ser 0)');
    ensure(
      isValidMoney(resposta.guardadoReal, { allowZero: true }),
      'guardadoReal',
      'Informe quanto sobrou guardado (pode ser 0)',
    );
    this.props.rendaReal = resposta.rendaReal;
    this.props.gastoReal = resposta.gastoReal;
    this.props.guardadoReal = resposta.guardadoReal;
    this.props.respondidoEm = agora;
  }

  toSnapshot(): CheckInProps {
    return structuredClone(this.props);
  }
}
