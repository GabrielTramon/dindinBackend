import type { BackgroundJobs, Clock, Mailer } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { normalizarEmail } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { emailCriarSenhaNova } from './emails/criar-senha-nova';
import type { EmissorDeLinks } from './links-por-email';

export interface SolicitarRedefinicaoDeSenhaInput {
  email: string;
}

/** Nome da tarefa no log quando o envio falha. */
export const TAREFA_ESQUECI_SENHA = 'link do Esqueci a senha';

/*
  "Esqueci a senha": manda o link "Criar uma senha nova" pro e-mail da conta.

  O pedido só valida o e-mail (inválido é 400) e volta: a busca da conta, a
  gravação do link e o envio rodam DEPOIS da resposta (BackgroundJobs). Com
  tudo isso no caminho da resposta, um e-mail com conta demorava o save + o
  POST pro provedor e um sem conta respondia na hora; e o provedor fora do ar
  virava 500 só pra quem tem conta. Agora e-mail com conta, sem conta ou dentro
  do limite de reenvio terminam iguais pra quem chamou — no corpo e no tempo.

  Serve também pra conta antiga do link mágico, que nunca teve senha: é por
  aqui que ela cria a primeira.

  Envio que falhou anula o link (a próxima tentativa não cai no limite de
  reenvio por um e-mail que não chegou) e vai pro log da tarefa. A pessoa não
  fica sabendo — a frase da resposta já diz "se existir uma conta…", e ela
  pede de novo se o e-mail não vier.
*/
export class SolicitarRedefinicaoDeSenhaUseCase implements UseCase<SolicitarRedefinicaoDeSenhaInput, void> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly links: EmissorDeLinks,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    private readonly jobs: BackgroundJobs,
  ) {}

  async execute({ email }: SolicitarRedefinicaoDeSenhaInput): Promise<void> {
    // ValidationError (400) sai daqui, antes de qualquer consulta: não diz nada sobre contas
    const endereco = normalizarEmail(email);
    this.jobs.run(TAREFA_ESQUECI_SENHA, () => this.enviarLink(endereco));
  }

  /** A parte que não espera por ninguém. Lança quando o envio falha (a tarefa registra no log). */
  private async enviarLink(endereco: string): Promise<void> {
    const subscriber = await this.subscribers.findByEmail(endereco);
    if (!subscriber) return;

    const agora = this.clock.now();
    // limite por endereço: sem ele, qualquer um lota a caixa de entrada de alguém trocando de IP
    if (this.links.emitiuHaPouco(subscriber, agora)) return;

    // o link novo substitui o pendente (inclusive o de confirmação: este também confirma o e-mail)
    const link = this.links.gerar('redefinicao', agora);
    subscriber.emitirLinkMagico(link.tokenHash, link.expiraEm, agora);
    await this.subscribers.save(subscriber);

    const mensagem = emailCriarSenhaNova({
      para: subscriber.email,
      appUrl: this.links.appUrl,
      token: link.token,
      validadeEmMinutos: link.validadeEmMinutos,
    });
    try {
      await this.mailer.send(mensagem);
    } catch (erro) {
      subscriber.invalidarLinkMagico(this.clock.now());
      await this.subscribers.save(subscriber);
      throw erro;
    }
  }
}
