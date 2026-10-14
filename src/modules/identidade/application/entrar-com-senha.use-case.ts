import type { AuthTokenService, PasswordHasher } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { EmailNaoConfirmadoError, UnauthorizedError } from '../../../shared/domain/errors';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { credenciaisDeEntrada } from './credenciais';
import type { SessaoAberta } from './sessao-aberta';

/** E-mail sem conta, senha errada e conta sem senha: a MESMA resposta pros três. */
export const MENSAGEM_CREDENCIAIS_INVALIDAS = 'E-mail ou senha incorretos.';

/*
  Qualquer senha "de mentira" serve: o hash dela só existe pra conferência
  rodar com o mesmo custo quando não há senha de verdade pra conferir. Mesmo
  que alguém digite exatamente isto, o resultado é descartado.
*/
const SENHA_DE_MENTIRA = 'dindin: conferência sem conta, só pra gastar o mesmo tempo';

export interface EntrarComSenhaInput {
  email: string;
  senha: string;
}

/** A conta existe e a senha confere, mas o e-mail não foi confirmado: a tela oferece mandar o link de novo. */
export function mensagemEmailNaoConfirmado(email: string): string {
  return `Falta confirmar seu e-mail. Abra o link que mandamos pra ${email} — a conta só passa a valer depois disso.`;
}

/**
 * Entrar com e-mail e senha. Exige o e-mail confirmado: a conta só passa a
 * valer pelo link do "Confirme seu e-mail" (CadastrarComSenha). Não exige conta
 * ativa (descadastro só para o e-mail mensal).
 *
 * O "falta confirmar" só sai DEPOIS da senha conferida: sem a senha, a conta
 * pendente responde o mesmo 401 de sempre e não revela que o e-mail tem conta.
 */
export class EntrarComSenhaUseCase implements UseCase<EntrarComSenhaInput, SessaoAberta> {
  private hashDeMentira: Promise<string> | null = null;

  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly passwords: PasswordHasher,
    private readonly authTokens: AuthTokenService,
  ) {}

  async execute({ email, senha }: EntrarComSenhaInput): Promise<SessaoAberta> {
    const endereco = credenciaisDeEntrada(email, senha);
    const subscriber = await this.subscribers.findByEmail(endereco);
    const senhaHash = subscriber?.senhaHash ?? null;

    if (subscriber === null || senhaHash === null) {
      // sem conta, ou conta antiga sem senha: confere assim mesmo, contra um hash descartável.
      // Responder na hora deixaria o tempo dizer quais e-mails têm conta.
      await this.passwords.verify(senha, await this.hashQualquer());
      throw new UnauthorizedError(MENSAGEM_CREDENCIAIS_INVALIDAS);
    }

    if (!(await this.passwords.verify(senha, senhaHash))) throw new UnauthorizedError(MENSAGEM_CREDENCIAIS_INVALIDAS);
    if (subscriber.emailVerificadoEm === null) throw new EmailNaoConfirmadoError(mensagemEmailNaoConfirmado(subscriber.email));
    return { subscriber, sessao: this.authTokens.issueSession(subscriber.id, subscriber.versaoSessao) };
  }

  /** Gerado uma vez por processo, com os mesmos parâmetros das senhas de verdade (logo, o mesmo custo). */
  private hashQualquer(): Promise<string> {
    this.hashDeMentira ??= this.passwords.hash(SENHA_DE_MENTIRA).catch((erro: unknown) => {
      // não guarda a falha: a próxima tentativa gera de novo
      this.hashDeMentira = null;
      throw erro;
    });
    return this.hashDeMentira;
  }
}
