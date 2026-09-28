import type { Page } from '../../../shared/application/pagination';
import type { AuthTokenService, Clock, IdGenerator, Mailer } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { BusinessRuleError, ConflictError } from '../../../shared/domain/errors';
import type { Subscriber, SubscribersRepository } from '../../identidade';
import { CheckIn, competenciaAnterior } from '../domain/check-in';
import type { CheckInsRepository } from '../domain/check-ins-repository';
import { emailCheckInMensal } from './emails/check-in-mensal';

/*
  O job do dia 1: abre o check-in do mês que acabou pra cada pessoa que pode
  receber e-mail (ativa e com e-mail confirmado) e manda a pergunta.

  Idempotente — rodar de novo no mesmo mês não duplica nada:
  - abrir: busca antes; se outra execução inseriu entre a busca e o insert, a
    unique (subscriberId, competencia) responde ConflictError e seguimos com o
    que ela gravou (conta como "já existia");
  - enviar: quem já respondeu ou já recebeu não recebe de novo; e o envio é
    reservado com claimSend (compare-and-set em enviadoEm) ANTES de mandar —
    duas execuções sobrepostas disputam a mesma linha e só uma envia.

  Um e-mail ruim não derruba o job: se o envio falha, a reserva é desfeita
  (releaseSendClaim) pra próxima execução tentar de novo, conta em `falhas` e o
  job segue pro próximo. Conta excluída entre a listagem e o insert (a FK recusa
  com BusinessRuleError) também conta em `falhas` e segue — a pessoa não existe
  mais, e a próxima execução nem a lista.

  Erro de banco (conexão caiu) sobe e para o job: o que já foi feito fica, e
  rodar de novo continua de onde parou pelas mesmas regras acima.

  Nada roda em transactions.run: cada pessoa é independente, e no Postgres o
  ConflictError da abertura deixaria a transação abortada.

  QUAL MÊS: competenciaAnterior(agora) no fuso de São Paulo. O job precisa rodar
  depois da meia-noite do dia 1 em Brasília (03:00 UTC); às 02:30 UTC do dia 1
  ainda é o último dia do mês em São Paulo, e ele abriria o mês retrasado.
*/

export const TAMANHO_DA_PAGINA_PADRAO = 100;

export interface CheckInMensalConfig {
  /** base do frontend: links pra `${appUrl}/check-in/<competencia>` e `${appUrl}/descadastrar#token=…` */
  appUrl: string;
}

export interface AbrirCheckInsDoMesInput {
  /** quantos subscribers buscar por vez (padrão 100) */
  tamanhoDaPagina?: number;
}

export interface RelatorioAberturaCheckIns {
  /** o mês aberto: "2026-09" */
  competencia: string;
  /** check-ins criados nesta execução */
  abertos: number;
  /** já estavam abertos (outra execução, ou a pessoa respondeu antes do e-mail) */
  jaExistiam: number;
  /** e-mails entregues ao provedor nesta execução */
  enviados: number;
  /** não enviados porque a pessoa já respondeu, já recebeu, ou outra execução reservou o envio */
  jaEnviados: number;
  /** envio que falhou (reserva desfeita, a próxima execução tenta de novo) ou conta excluída no meio */
  falhas: number;
}

export class AbrirCheckInsDoMesUseCase implements UseCase<AbrirCheckInsDoMesInput, RelatorioAberturaCheckIns> {
  constructor(
    private readonly checkIns: CheckInsRepository,
    private readonly subscribers: SubscribersRepository,
    private readonly mailer: Mailer,
    private readonly authTokens: AuthTokenService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly config: CheckInMensalConfig,
  ) {}

  async execute({ tamanhoDaPagina = TAMANHO_DA_PAGINA_PADRAO }: AbrirCheckInsDoMesInput = {}): Promise<RelatorioAberturaCheckIns> {
    const agora = this.clock.now();
    const relatorio: RelatorioAberturaCheckIns = {
      competencia: competenciaAnterior(agora),
      abertos: 0,
      jaExistiam: 0,
      enviados: 0,
      jaEnviados: 0,
      falhas: 0,
    };

    let cursor: string | null = null;
    do {
      // tipo explícito: o cursor da próxima volta depende desta página, e a inferência ficaria circular
      const pagina: Page<Subscriber> = await this.subscribers.listEmailable({ limit: tamanhoDaPagina, cursor });
      for (const subscriber of pagina.items) {
        await this.processar(subscriber, agora, relatorio);
      }
      cursor = pagina.nextCursor;
    } while (cursor !== null);

    return relatorio;
  }

  private async processar(subscriber: Subscriber, agora: Date, relatorio: RelatorioAberturaCheckIns): Promise<void> {
    const aberto = await this.abrirOuCarregar(subscriber.id, relatorio.competencia, agora);
    if (aberto === null) {
      relatorio.falhas++;
      return;
    }
    const { checkIn, novo } = aberto;
    if (novo) relatorio.abertos++;
    else relatorio.jaExistiam++;

    // a pessoa respondeu antes do e-mail, ou uma execução anterior já mandou
    if (checkIn.respondido || checkIn.enviadoEm !== null) {
      relatorio.jaEnviados++;
      return;
    }
    // outra execução reservou entre a nossa leitura e aqui: ela manda, nós não
    if (!(await this.checkIns.claimSend(checkIn.id, agora))) {
      relatorio.jaEnviados++;
      return;
    }

    try {
      const { token } = this.authTokens.issueUnsubscribe(subscriber.id);
      await this.mailer.send(
        emailCheckInMensal({
          para: subscriber.email,
          appUrl: this.config.appUrl,
          competencia: relatorio.competencia,
          tokenDescadastro: token,
        }),
      );
      relatorio.enviados++;
    } catch {
      // o e-mail não saiu: sem desfazer a reserva, a pessoa nunca mais receberia este mês
      await this.checkIns.releaseSendClaim(checkIn.id);
      relatorio.falhas++;
    }
  }

  /** null quando a conta foi excluída entre a listagem e o insert */
  private async abrirOuCarregar(
    subscriberId: string,
    competencia: string,
    agora: Date,
  ): Promise<{ checkIn: CheckIn; novo: boolean } | null> {
    const existente = await this.checkIns.findByCompetencia(subscriberId, competencia);
    if (existente) return { checkIn: existente, novo: false };

    const checkIn = CheckIn.abrir({ id: this.ids.generate(), subscriberId, competencia, agora });
    try {
      await this.checkIns.save(checkIn);
      return { checkIn, novo: true };
    } catch (erro) {
      if (erro instanceof BusinessRuleError) return null;
      if (!(erro instanceof ConflictError)) throw erro;
      // outra execução (ou a própria pessoa respondendo) inseriu primeiro: segue com o dela
      const vencedor = await this.checkIns.findByCompetencia(subscriberId, competencia);
      if (!vencedor) throw erro;
      return { checkIn: vencedor, novo: false };
    }
  }
}
