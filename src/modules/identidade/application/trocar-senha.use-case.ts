import type { AuthTokenService, Clock, PasswordHasher } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { NotFoundError } from '../../../shared/domain/errors';
import { invalid } from '../../../shared/domain/guards';
import { SENHA_MAX, validarSenhaNova } from '../domain/senha';
import type { SubscribersRepository } from '../domain/subscribers-repository';
import { carregarConta } from './carregar-conta';
import { validarJuntos } from './credenciais';
import type { SessaoAberta } from './sessao-aberta';

export const MENSAGEM_SENHA_ATUAL_NAO_CONFERE = 'A senha atual não confere.';
export const MENSAGEM_INFORME_A_SENHA_ATUAL = 'Informe a sua senha atual.';

export interface TrocarSenhaInput {
  subscriberId: string;
  /** obrigatória quando a conta já tem senha; ignorada na conta antiga, sem senha */
  senhaAtual?: string;
  senhaNova: string;
}

/*
  Trocar a senha com a sessão aberta (página da conta).

  Senha atual errada é ValidationError (400) no campo `senhaAtual`, NUNCA
  UnauthorizedError: o frontend trata todo 401 como sessão vencida e tiraria a
  pessoa da conta por um erro de digitação.

  A conta antiga do link mágico, que nunca teve senha, cria a primeira aqui só
  com a nova — não existe "atual" pra conferir, e a sessão já prova quem é.

  A senha nova encerra TODAS as sessões de antes (versaoSessao), inclusive a
  deste pedido: quem troca a senha porque alguém a descobriu tira essa pessoa
  dos outros aparelhos. Por isso devolve uma sessão nova, e o cliente troca o
  token que guardava por ela.
*/
export class TrocarSenhaUseCase implements UseCase<TrocarSenhaInput, SessaoAberta> {
  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly passwords: PasswordHasher,
    private readonly authTokens: AuthTokenService,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId, senhaAtual, senhaNova }: TrocarSenhaInput): Promise<SessaoAberta> {
    const subscriber = await carregarConta(this.subscribers, subscriberId);
    const hashAtual = subscriber.senhaHash;
    // conferida antes do validarJuntos: a conferência é assíncrona, as validações não
    const atualConfere =
      hashAtual === null ||
      (senhaAtual !== undefined &&
        senhaAtual !== '' &&
        senhaAtual.length <= SENHA_MAX &&
        (await this.passwords.verify(senhaAtual, hashAtual)));

    validarJuntos(
      () => {
        if (atualConfere) return;
        invalid('senhaAtual', senhaAtual ? MENSAGEM_SENHA_ATUAL_NAO_CONFERE : MENSAGEM_INFORME_A_SENHA_ATUAL);
      },
      () => validarSenhaNova(senhaNova, 'senhaNova'),
    );

    subscriber.definirSenha(await this.passwords.hash(senhaNova), this.clock.now());
    // só a senha (e a versão das sessões): um link emitido ou um descadastro gravados no meio continuam valendo
    if (!(await this.subscribers.savePassword(subscriber))) throw new NotFoundError('Conta não encontrada.');
    return { subscriber, sessao: this.authTokens.issueSession(subscriber.id, subscriber.versaoSessao) };
  }
}
