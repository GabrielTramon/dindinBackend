import type { AuthTokenService, PasswordHasher } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { UnauthorizedError } from '../../../shared/domain/errors';
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

/**
 * Entrar com e-mail e senha. Não exige e-mail confirmado (a pessoa entra na hora
 * do cadastro) nem conta ativa (descadastro só para o e-mail mensal).
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
