import type { AuthTokenService, Clock, IdGenerator, Mailer, PasswordHasher } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { ConflictError } from '../../../shared/domain/errors';
import { Subscriber } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { credenciaisDeCadastro } from './credenciais';
import { emailConfirmarEmail } from './emails/confirmar-email';
import type { EmissorDeLinks } from './links-por-email';
import type { SessaoAberta } from './sessao-aberta';

export const MENSAGEM_EMAIL_JA_CADASTRADO =
  'Já existe uma conta com esse e-mail. Entre com a sua senha ou use “Esqueci a senha”.';

export interface CadastrarComSenhaInput {
  email: string;
  senha: string;
}

export interface CadastrarComSenhaOutput extends SessaoAberta {
  /**
   * null quando o "Confirme seu e-mail" saiu. Com o erro do envio, a conta existe
   * e a sessão vale do mesmo jeito — o link foi anulado e a confirmação fica pra
   * depois (o Esqueci a senha também confirma). Quem chama registra no log.
   */
  falhaNoEnvio: { erro: unknown } | null;
}

/*
  Criar conta com e-mail e senha. Entra na hora: a sessão sai junto, sem
  esperar e-mail nenhum chegar. O e-mail de confirmação vai em seguida.

  E-mail que já tem conta é 409 — inclusive conta antiga, do link mágico, sem
  senha: o caminho dela é o "Esqueci a senha", que cria a senha por um link no
  e-mail. Deixar o cadastro "tomar" a conta daria a qualquer um a conta de
  outra pessoa só sabendo o e-mail.

  Sem transactions.run de propósito: a corrida no cadastro é resolvida
  capturando o ConflictError do UNIQUE. Dentro de uma transação do Postgres, o
  erro deixaria a transação abortada (25P02) e a busca seguinte falharia.
*/
export class CadastrarComSenhaUseCase implements UseCase<CadastrarComSenhaInput, CadastrarComSenhaOutput> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly passwords: PasswordHasher,
    private readonly links: EmissorDeLinks,
    private readonly authTokens: AuthTokenService,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute({ email, senha }: CadastrarComSenhaInput): Promise<CadastrarComSenhaOutput> {
    const endereco = credenciaisDeCadastro(email, senha);
    // antes do hash, que é caro de propósito: e-mail repetido responde na hora
    if (await this.subscribers.findByEmail(endereco)) throw this.jaCadastrado();

    const senhaHash = await this.passwords.hash(senha);
    const agora = this.clock.now();
    const link = this.links.gerar('confirmacao', agora);
    const subscriber = Subscriber.criar({
      id: this.ids.generate(),
      email: endereco,
      tokenHash: link.tokenHash,
      tokenExpiraEm: link.expiraEm,
      senhaHash,
      agora,
    });

    try {
      await this.subscribers.save(subscriber);
    } catch (erro) {
      // outro cadastro do mesmo e-mail gravou entre a busca e o insert (UNIQUE): a mesma resposta
      // de "já existe". Conflito que não foi o e-mail (hash de token repetido) não tem como seguir.
      if (erro instanceof ConflictError && (await this.subscribers.findByEmail(endereco))) throw this.jaCadastrado();
      throw erro;
    }

    const falhaNoEnvio = await this.enviarConfirmacao(subscriber, link.token, link.validadeEmMinutos);
    return { subscriber, sessao: this.authTokens.issueSession(subscriber.id, subscriber.versaoSessao), falhaNoEnvio };
  }

  private jaCadastrado(): ConflictError {
    return new ConflictError(MENSAGEM_EMAIL_JA_CADASTRADO, { email: MENSAGEM_EMAIL_JA_CADASTRADO });
  }

  /**
   * Falha no envio não derruba o cadastro: a conta já existe e a pessoa já pode
   * entrar. O link que não chegou é anulado — pendente, ele faria o primeiro
   * "Esqueci a senha" cair no limite de reenvio por um e-mail que ninguém recebeu.
   * @returns o erro do envio, ou null quando saiu
   */
  private async enviarConfirmacao(
    subscriber: Subscriber,
    token: string,
    validadeEmMinutos: number,
  ): Promise<{ erro: unknown } | null> {
    try {
      await this.mailer.send(
        emailConfirmarEmail({ para: subscriber.email, appUrl: this.links.appUrl, token, validadeEmMinutos }),
      );
      return null;
    } catch (erro) {
      subscriber.invalidarLinkMagico(this.clock.now());
      try {
        await this.subscribers.save(subscriber);
      } catch {
        // sem banco agora: o link fica pendente e só vence sozinho. A conta e a sessão valem igual.
      }
      return { erro };
    }
  }
}
