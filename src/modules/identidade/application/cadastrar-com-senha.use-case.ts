import type { Clock, IdGenerator, Mailer, PasswordHasher } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { ConflictError } from '../../../shared/domain/errors';
import { Subscriber } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { credenciaisDeCadastro } from './credenciais';
import { emailConfirmarEmail } from './emails/confirmar-email';
import type { EmissorDeLinks } from './links-por-email';

export const MENSAGEM_EMAIL_JA_CADASTRADO =
  'Já existe uma conta com esse e-mail. Entre com a sua senha ou use “Esqueci a senha”.';

export interface CadastrarComSenhaInput {
  email: string;
  senha: string;
}

export interface CadastrarComSenhaOutput {
  /** a conta pendente: só passa a valer quando o link do e-mail for aberto */
  subscriber: Subscriber;
  /**
   * false quando já tinha saído um link pra esse endereço há menos do intervalo
   * mínimo: nada mudou (nem a senha) e o link de antes continua valendo
   */
  enviouLink: boolean;
}

/*
  Criar conta com e-mail e senha. A conta SÓ PASSA A VALER quando a pessoa abre
  o link "Confirme seu e-mail" (decisão do dono, 14/10/2026): o cadastro não
  abre sessão, e o login de conta não confirmada é recusado (EntrarComSenha).
  O link confirma e já entra (VerificarLinkMagico).

  A conta fica gravada enquanto espera (pendente: emailVerificadoEm null), e o
  link vale com a senha do ÚLTIMO cadastro desse endereço:
  - endereço com conta confirmada → 409, como sempre;
  - endereço com conta pendente → o cadastro de novo troca a senha e manda um
    link novo (o de antes deixa de valer). Sem isso, quem digitou o e-mail de
    outra pessoa "seguraria" o endereço, e a dona do e-mail nunca criaria a
    conta dela — ou, pior, confirmaria a conta com a senha de quem cadastrou;
  - de novo dentro do intervalo mínimo entre links → nada muda (nem a senha),
    e a resposta é a mesma. Trocar a senha sem mandar link faria o link que já
    está na caixa de entrada ativar a conta com a senha de outra pessoa.

  Envio que falhou anula o link e vira erro (500): sem sessão, a pessoa não tem
  outro caminho além de tentar de novo — e a próxima tentativa manda um link
  novo, porque o anulado não conta pro intervalo.

  Sem transactions.run de propósito: a corrida no cadastro é resolvida
  capturando o ConflictError do UNIQUE. Dentro de uma transação do Postgres, o
  erro deixaria a transação abortada (25P02) e a busca seguinte falharia.
*/
export class CadastrarComSenhaUseCase implements UseCase<CadastrarComSenhaInput, CadastrarComSenhaOutput> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly passwords: PasswordHasher,
    private readonly links: EmissorDeLinks,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute({ email, senha }: CadastrarComSenhaInput): Promise<CadastrarComSenhaOutput> {
    const endereco = credenciaisDeCadastro(email, senha);
    const existente = await this.subscribers.findByEmail(endereco);
    // antes do hash, que é caro de propósito: e-mail de conta confirmada responde na hora
    if (existente?.emailVerificadoEm) throw this.jaCadastrado();

    const agora = this.clock.now();
    if (existente && this.links.emitiuHaPouco(existente, agora)) return { subscriber: existente, enviouLink: false };

    const senhaHash = await this.passwords.hash(senha);
    const link = this.links.gerar('confirmacao', agora);
    let subscriber: Subscriber;
    if (existente) {
      // pendente: o último cadastro vale (senha nova, link novo; as sessões de antes caem).
      // Duas escritas, nesta ordem: o link novo primeiro — ele já invalida o de antes —, e
      // só depois a senha (o save() não grava senha em linha existente). Parando no meio,
      // fica o link novo com a senha antiga e nenhum e-mail enviado: nenhum link que
      // está numa caixa de entrada passa a valer com a senha de outra pessoa.
      subscriber = existente;
      subscriber.emitirLinkMagico(link.tokenHash, link.expiraEm, agora);
      subscriber.definirSenha(senhaHash, agora);
      await this.subscribers.save(subscriber);
      // false só se a conta sumiu entre as duas escritas — e aí o save() acima já a gravou de novo, com esta senha
      await this.subscribers.savePassword(subscriber);
    } else {
      subscriber = Subscriber.criar({
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
    }

    await this.enviarConfirmacao(subscriber, link.token, link.validadeEmMinutos);
    return { subscriber, enviouLink: true };
  }

  private jaCadastrado(): ConflictError {
    return new ConflictError(MENSAGEM_EMAIL_JA_CADASTRADO, { email: MENSAGEM_EMAIL_JA_CADASTRADO });
  }

  /**
   * Sem o e-mail, a conta não tem como passar a valer: a falha sobe. O link que
   * não chegou é anulado antes — pendente, ele faria a próxima tentativa cair no
   * intervalo de reenvio por um e-mail que ninguém recebeu.
   */
  private async enviarConfirmacao(subscriber: Subscriber, token: string, validadeEmMinutos: number): Promise<void> {
    try {
      await this.mailer.send(
        emailConfirmarEmail({ para: subscriber.email, appUrl: this.links.appUrl, token, validadeEmMinutos }),
      );
    } catch (erro) {
      subscriber.invalidarLinkMagico(this.clock.now());
      try {
        await this.subscribers.save(subscriber);
      } catch {
        // sem banco agora: o link fica pendente e só vence sozinho; o erro que importa é o do envio
      }
      throw erro;
    }
  }
}
