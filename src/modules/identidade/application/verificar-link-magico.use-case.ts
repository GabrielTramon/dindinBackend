import type { AuthTokenService, Clock, IssuedToken, SecureTokenGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { UnauthorizedError } from '../../../shared/domain/errors';
import type { Subscriber } from '../domain/subscriber';
import type { SubscribersRepository } from '../domain/subscribers-repository';

export interface VerificarLinkMagicoInput {
  /** o token que veio no fragmento do link */
  token: string;
}

export interface VerificarLinkMagicoOutput {
  subscriber: Subscriber;
  sessao: IssuedToken;
}

// inexistente, usado, vencido ou trocado por um link novo: a mesma resposta pra todos
const LINK_INVALIDO = 'Esse link expirou ou já foi usado. Peça um novo.';

/** Troca o link mágico por uma sessão. Uso único: o primeiro clique vale, os outros não. */
export class VerificarLinkMagicoUseCase implements UseCase<VerificarLinkMagicoInput, VerificarLinkMagicoOutput> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly secureTokens: SecureTokenGenerator,
    private readonly authTokens: AuthTokenService,
    private readonly clock: Clock,
  ) {}

  async execute({ token }: VerificarLinkMagicoInput): Promise<VerificarLinkMagicoOutput> {
    const tokenHash = this.secureTokens.hash(token);
    const subscriber = await this.subscribers.findByTokenHash(tokenHash);
    if (!subscriber) throw new UnauthorizedError(LINK_INVALIDO);

    subscriber.consumirLinkMagico(this.clock.now());

    // Nunca save() aqui. Ler-e-gravar não garante uso único: dois cliques simultâneos
    // leem o mesmo hash e os dois abririam sessão. E a linha inteira gravada desfaria
    // um descadastro feito no meio. O compare-and-set resolve as duas coisas.
    const consumiu = await this.subscribers.saveMagicLinkConsumption(subscriber, tokenHash);
    if (!consumiu) throw new UnauthorizedError(LINK_INVALIDO);

    return { subscriber, sessao: this.authTokens.issueSession(subscriber.id) };
  }
}
