import type { Clock, IdGenerator, Mailer, SecureTokenGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { ConflictError } from '../../../shared/domain/errors';
import { normalizarEmail, Subscriber } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { emailLinkMagico } from './emails/link-magico';

/** Regra do produto: sem reenvio se o último link do endereço saiu há menos disso. */
export const INTERVALO_MINIMO_ENTRE_LINKS_SEGUNDOS = 60;

export interface LinkMagicoConfig {
  /** base do frontend: o link aponta pra `${appUrl}/entrar#token=…` */
  appUrl: string;
  magicLinkTtlMinutes: number;
  linkResendCooldownSeconds: number;
}

export interface SolicitarLinkMagicoInput {
  email: string;
}

/*
  Pedido de link mágico — login e cadastro são o mesmo gesto: deixar o e-mail.

  Não devolve nada de propósito: e-mail novo, existente ou dentro do limite de
  reenvio terminam iguais pra quem chamou, e a resposta HTTP não revela se o
  endereço tem conta.

  Sem transactions.run de propósito: a corrida no cadastro é resolvida capturando
  o ConflictError do UNIQUE e seguindo. Dentro de uma transação do Postgres, o
  erro deixaria a transação abortada (25P02) e a busca seguinte falharia.
*/
export class SolicitarLinkMagicoUseCase implements UseCase<SolicitarLinkMagicoInput, void> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly secureTokens: SecureTokenGenerator,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly config: LinkMagicoConfig,
  ) {}

  async execute({ email }: SolicitarLinkMagicoInput): Promise<void> {
    const endereco = normalizarEmail(email);
    const agora = this.clock.now();
    const token = this.secureTokens.generate();
    // só o hash vai pro banco; o token em si existe apenas no e-mail
    const tokenHash = this.secureTokens.hash(token);
    const expiraEm = new Date(agora.getTime() + this.config.magicLinkTtlMinutes * 60_000);

    const existente = await this.subscribers.findByEmail(endereco);
    const { subscriber, criado } = existente
      ? { subscriber: existente, criado: false }
      : await this.cadastrar(endereco, tokenHash, expiraEm, agora);

    if (!criado) {
      // limite por endereço: sem ele, qualquer um lota a caixa de entrada de alguém trocando de IP
      if (this.emitiuLinkHaPouco(subscriber, agora)) return;
      subscriber.emitirLinkMagico(tokenHash, expiraEm, agora);
      await this.subscribers.save(subscriber);
    }

    await this.enviar(subscriber, token);
  }

  /**
   * Cadastra com o link já emitido. Se outro pedido cadastrou o mesmo e-mail entre
   * a busca e o insert (UNIQUE → ConflictError), devolve o que ele gravou pra seguir
   * como conta existente — e aí o limite de reenvio segura o segundo e-mail.
   */
  private async cadastrar(
    email: string,
    tokenHash: string,
    expiraEm: Date,
    agora: Date,
  ): Promise<{ subscriber: Subscriber; criado: boolean }> {
    const novo = Subscriber.criar({ id: this.ids.generate(), email, tokenHash, tokenExpiraEm: expiraEm, agora });
    try {
      await this.subscribers.save(novo);
      return { subscriber: novo, criado: true };
    } catch (erro) {
      if (!(erro instanceof ConflictError)) throw erro;
      const vencedor = await this.subscribers.findByEmail(email);
      // conflito que não foi o e-mail: não há como seguir
      if (!vencedor) throw erro;
      return { subscriber: vencedor, criado: false };
    }
  }

  private emitiuLinkHaPouco(subscriber: Subscriber, agora: Date): boolean {
    const emitidoEm = subscriber.linkEmitidoEm(this.config.magicLinkTtlMinutes);
    if (emitidoEm === null) return false;
    // valor absoluto: uma emissão "no futuro" vem de relógios de instâncias levemente
    // desalinhados (conta como agora) ou de validade reduzida na config — nesse caso a
    // diferença passa do intervalo e o endereço não fica travado até a data calculada
    const decorridoMs = Math.abs(agora.getTime() - emitidoEm.getTime());
    return decorridoMs < this.config.linkResendCooldownSeconds * 1000;
  }

  private async enviar(subscriber: Subscriber, token: string): Promise<void> {
    const mensagem = emailLinkMagico({
      para: subscriber.email,
      appUrl: this.config.appUrl,
      token,
      validadeEmMinutos: this.config.magicLinkTtlMinutes,
    });
    try {
      await this.mailer.send(mensagem);
    } catch (erro) {
      // o link nunca chegou: pendente, ele faria a próxima tentativa cair no limite de reenvio
      subscriber.invalidarLinkMagico(this.clock.now());
      await this.subscribers.save(subscriber);
      throw erro;
    }
  }
}
