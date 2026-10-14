import type { BackgroundJobs, Clock, Mailer } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { normalizarEmail } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { emailConfirmarEmail } from './emails/confirmar-email';
import type { EmissorDeLinks } from './links-por-email';

export interface ReenviarConfirmacaoInput {
  email: string;
}

/** Nome da tarefa no log quando o envio falha. */
export const TAREFA_REENVIAR_CONFIRMACAO = 'link do Confirme seu e-mail (reenvio)';

/*
  "Mandar o link de novo": um "Confirme seu e-mail" novo pra conta que ainda
  não confirmou. É o caminho de quem não achou o e-mail, deixou o link vencer
  ou tentou entrar antes de confirmar (a conta só passa a valer pelo link).

  Mesmo desenho do Esqueci a senha: o pedido só valida o e-mail (inválido é
  400) e volta com a mesma frase; a busca, o link e o envio rodam depois da
  resposta (BackgroundJobs). E-mail sem conta, de conta já confirmada ou dentro
  do intervalo de reenvio terminam iguais pra quem chamou — no corpo e no tempo.

  O link novo substitui o pendente (o de antes deixa de valer). A senha não
  muda: quem quer trocar a senha da conta pendente cadastra de novo.
*/
export class ReenviarConfirmacaoUseCase implements UseCase<ReenviarConfirmacaoInput, void> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly links: EmissorDeLinks,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    private readonly jobs: BackgroundJobs,
  ) {}

  async execute({ email }: ReenviarConfirmacaoInput): Promise<void> {
    // ValidationError (400) sai daqui, antes de qualquer consulta: não diz nada sobre contas
    const endereco = normalizarEmail(email);
    this.jobs.run(TAREFA_REENVIAR_CONFIRMACAO, () => this.enviarLink(endereco));
  }

  /** A parte que não espera por ninguém. Lança quando o envio falha (a tarefa registra no log). */
  private async enviarLink(endereco: string): Promise<void> {
    const subscriber = await this.subscribers.findByEmail(endereco);
    // sem conta, ou já confirmada: nada a mandar
    if (!subscriber || subscriber.emailVerificadoEm !== null) return;

    const agora = this.clock.now();
    // limite por endereço: sem ele, qualquer um lota a caixa de entrada de alguém trocando de IP
    if (this.links.emitiuHaPouco(subscriber, agora)) return;

    const link = this.links.gerar('confirmacao', agora);
    subscriber.emitirLinkMagico(link.tokenHash, link.expiraEm, agora);
    await this.subscribers.save(subscriber);

    try {
      await this.mailer.send(
        emailConfirmarEmail({
          para: subscriber.email,
          appUrl: this.links.appUrl,
          token: link.token,
          validadeEmMinutos: link.validadeEmMinutos,
        }),
      );
    } catch (erro) {
      subscriber.invalidarLinkMagico(this.clock.now());
      await this.subscribers.save(subscriber);
      throw erro;
    }
  }
}
