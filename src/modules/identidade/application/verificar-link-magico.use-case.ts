import type { AuthTokenService, Clock, SecureTokenGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { UnauthorizedError } from '../../../shared/domain/errors';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { chaveDoLink, MENSAGEM_LINK_INVALIDO } from './links-por-email';
import type { SessaoAberta } from './sessao-aberta';

export interface VerificarLinkMagicoInput {
  /** o token que veio no fragmento do link */
  token: string;
}

export type VerificarLinkMagicoOutput = SessaoAberta;

/**
 * Troca o link do e-mail por uma sessão e confirma o endereço. Hoje é o link do
 * "Confirme seu e-mail" mandado no cadastro (/entrar#token=…). Uso único: o
 * primeiro clique vale, os outros não. O link de senha nova não serve aqui (ver chaveDoLink).
 */
export class VerificarLinkMagicoUseCase implements UseCase<VerificarLinkMagicoInput, VerificarLinkMagicoOutput> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly secureTokens: SecureTokenGenerator,
    private readonly authTokens: AuthTokenService,
    private readonly clock: Clock,
  ) {}

  async execute({ token }: VerificarLinkMagicoInput): Promise<VerificarLinkMagicoOutput> {
    // só o link de confirmação: o de senha nova não abre sessão sem trocar a senha
    const tokenHash = chaveDoLink(this.secureTokens, 'confirmacao', token);
    const subscriber = await this.subscribers.findByTokenHash(tokenHash);
    if (!subscriber) throw new UnauthorizedError(MENSAGEM_LINK_INVALIDO);

    subscriber.consumirLinkMagico(this.clock.now());

    // Nunca save() aqui. Ler-e-gravar não garante uso único: dois cliques simultâneos
    // leem o mesmo hash e os dois abririam sessão. E a linha inteira gravada desfaria
    // um descadastro feito no meio. O compare-and-set resolve as duas coisas.
    const consumiu = await this.subscribers.saveMagicLinkConsumption(subscriber, tokenHash);
    if (!consumiu) throw new UnauthorizedError(MENSAGEM_LINK_INVALIDO);

    return { subscriber, sessao: this.authTokens.issueSession(subscriber.id, subscriber.versaoSessao) };
  }
}
