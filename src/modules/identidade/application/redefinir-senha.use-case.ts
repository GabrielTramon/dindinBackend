import type { AuthTokenService, Clock, PasswordHasher, SecureTokenGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { UnauthorizedError } from '../../../shared/domain/errors';
import { validarSenhaNova } from '../domain/senha';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { chaveDoLink, MENSAGEM_LINK_INVALIDO } from './links-por-email';
import type { SessaoAberta } from './sessao-aberta';

export interface RedefinirSenhaInput {
  /** o token que veio no fragmento do link "Criar uma senha nova" */
  token: string;
  senha: string;
}

/**
 * Troca o link do e-mail por uma senha nova e já entra. Grava a senha, confirma
 * o e-mail (o link chegou nele) e gasta o link — tudo numa escrita só, com
 * compare-and-set: o primeiro uso vale, os outros não, e a senha nunca muda por
 * um link que outro pedido já gastou.
 */
export class RedefinirSenhaUseCase implements UseCase<RedefinirSenhaInput, SessaoAberta> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly secureTokens: SecureTokenGenerator,
    private readonly passwords: PasswordHasher,
    private readonly authTokens: AuthTokenService,
    private readonly clock: Clock,
  ) {}

  async execute({ token, senha }: RedefinirSenhaInput): Promise<SessaoAberta> {
    // senha fora da regra é 400 e NÃO gasta o link: a pessoa corrige e tenta de novo
    validarSenhaNova(senha);

    // só o link de senha nova: o de confirmação do e-mail (48 h) não cria senha
    const tokenHash = chaveDoLink(this.secureTokens, 'redefinicao', token);
    const subscriber = await this.subscribers.findByTokenHash(tokenHash);
    if (!subscriber) throw new UnauthorizedError(MENSAGEM_LINK_INVALIDO);

    const agora = this.clock.now();
    // confere a validade antes do hash (caro); vencido lança sem mudar nada
    subscriber.consumirLinkMagico(agora);
    subscriber.definirSenha(await this.passwords.hash(senha), agora);

    // Nunca save() aqui: ler-e-gravar não garante uso único (dois cliques no mesmo
    // link leem o mesmo hash) e a linha inteira desfaria um descadastro feito no meio.
    const gravou = await this.subscribers.savePasswordReset(subscriber, tokenHash);
    if (!gravou) throw new UnauthorizedError(MENSAGEM_LINK_INVALIDO);

    // a senha nova subiu a versão: as sessões de antes caíram, e esta já sai na versão nova
    return { subscriber, sessao: this.authTokens.issueSession(subscriber.id, subscriber.versaoSessao) };
  }
}
