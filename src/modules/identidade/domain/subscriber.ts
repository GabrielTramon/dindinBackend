import { UnauthorizedError } from '../../../shared/domain/errors';
import { ensure } from '../../../shared/domain/guards';

/*
  A conta: e-mail + senha. A senha nunca chega aqui — só o hash (a porta
  PasswordHasher faz a conta; ver shared/application/ports.ts).

  Além da senha, a conta tem UM link pendente por vez, que vai por e-mail:
  "Confirme seu e-mail" (no cadastro) ou "Criar uma senha nova" (no Esqueci a
  senha). Os dois dividem a mesma coluna `token` (um link novo substitui o
  pendente), mas cada um só serve pra sua finalidade: o valor gravado leva a
  finalidade na frente do hash ("confirmacao:<sha256>", "redefinicao:<sha256>";
  ver chaveDoLink em application/links-por-email.ts), e cada rota procura só
  pela sua. Sem isso, o link de confirmação (48 h) criaria senha e o de senha
  nova abriria sessão sem trocar a senha — um login sem senha.

  Ciclo do token:
    emitirLinkMagico   → guarda o hash e a validade (o token em si só vai no e-mail)
    consumirLinkMagico → confere a validade, confirma o e-mail e troca o hash por
                         `consumido:<id>`: o link não funciona duas vezes

  Por que `consumido:<id>` e não uma constante: a coluna `token` é UNIQUE NOT NULL.
  Uma constante colidiria no consumo da segunda pessoa. O id é chave primária,
  então o valor é único; e nenhuma finalidade se chama "consumido", então
  nenhum link chega nesse valor.

  Sessões: `versaoSessao` sobe a cada senha nova (definirSenha) e vai dentro de
  cada token de sessão. Token de versão velha não vale mais (SessionAccounts):
  redefinir ou trocar a senha encerra as sessões que já existiam — a de quem
  roubou a senha, ou a de quem criou a conta com o e-mail de outra pessoa.

  Uso único SOB CONCORRÊNCIA não é garantido aqui (dois cliques simultâneos
  leem o mesmo hash): é o `saveMagicLinkConsumption`/`savePasswordReset` do
  repositório, com compare-and-set no banco.
*/

export const PREFIXO_TOKEN_CONSUMIDO = 'consumido:';

export interface SubscriberProps {
  id: string;
  email: string;
  /** a finalidade + o SHA-256 do token do link que foi por e-mail (coluna `token`; ver chaveDoLink) */
  tokenHash: string;
  tokenExpiraEm: Date | null;
  /** hash da senha (PasswordHasher); null na conta antiga do link mágico, que ainda não criou senha */
  senhaHash: string | null;
  /** sobe a cada senha nova; token de sessão de outra versão não vale (SessionAccounts) */
  versaoSessao: number;
  emailVerificadoEm: Date | null;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizarEmail(email: string): string {
  const normalizado = email.trim().toLowerCase();
  ensure(normalizado.length <= 254 && EMAIL.test(normalizado), 'email', 'Informe um e-mail válido');
  return normalizado;
}

export class Subscriber {
  private constructor(private props: SubscriberProps) {}

  /**
   * Conta nova, já com o link de confirmação do e-mail emitido.
   * @param input.senhaHash o hash da senha escolhida no cadastro (ausente só em teste e em conta antiga)
   */
  static criar(input: {
    id: string;
    email: string;
    tokenHash: string;
    tokenExpiraEm: Date;
    senhaHash?: string | null;
    agora: Date;
  }): Subscriber {
    return new Subscriber({
      id: input.id,
      email: normalizarEmail(input.email),
      tokenHash: input.tokenHash,
      tokenExpiraEm: input.tokenExpiraEm,
      senhaHash: input.senhaHash ?? null,
      versaoSessao: 0,
      emailVerificadoEm: null,
      ativo: true,
      criadoEm: input.agora,
      atualizadoEm: input.agora,
    });
  }

  /** Reconstrói a partir do banco, sem revalidar. */
  static restaurar(props: SubscriberProps): Subscriber {
    return new Subscriber(structuredClone(props));
  }

  get id() { return this.props.id; }
  get email() { return this.props.email; }
  get tokenHash() { return this.props.tokenHash; }
  get tokenExpiraEm() { return this.props.tokenExpiraEm; }
  get senhaHash() { return this.props.senhaHash; }
  get versaoSessao() { return this.props.versaoSessao; }
  get emailVerificadoEm() { return this.props.emailVerificadoEm; }
  get ativo() { return this.props.ativo; }
  get criadoEm() { return this.props.criadoEm; }
  get atualizadoEm() { return this.props.atualizadoEm; }

  /** false só na conta antiga do link mágico: ela cria a senha sem informar a atual. */
  get temSenha(): boolean {
    return this.props.senhaHash !== null;
  }

  /** Só manda e-mail pra quem confirmou o endereço e não se descadastrou. */
  get podeReceberEmail(): boolean {
    return this.props.ativo && this.props.emailVerificadoEm !== null;
  }

  /**
   * Grava o hash de uma senha nova (redefinição, troca, primeira senha da conta
   * antiga) e sobe a versão das sessões: as que já existiam deixam de valer, e
   * quem chama abre uma nova, já na versão nova. Quem chama já validou a senha
   * (validarSenhaNova) e, na troca, conferiu a atual. O cadastro não passa por
   * aqui: a conta nasce com a senha, na versão 0.
   */
  definirSenha(senhaHash: string, agora: Date): void {
    // defeito de programação, não entrada da pessoa: um hash vazio travaria a conta
    if (senhaHash === '') throw new Error('hash de senha vazio');
    this.props.senhaHash = senhaHash;
    this.props.versaoSessao += 1;
    this.props.atualizadoEm = agora;
  }

  emitirLinkMagico(tokenHash: string, expiraEm: Date, agora: Date): void {
    this.props.tokenHash = tokenHash;
    this.props.tokenExpiraEm = expiraEm;
    this.props.atualizadoEm = agora;
  }

  /** @throws UnauthorizedError quando o link já foi usado ou venceu */
  consumirLinkMagico(agora: Date): void {
    const expira = this.props.tokenExpiraEm;
    if (expira === null || agora.getTime() > expira.getTime()) {
      throw new UnauthorizedError('Esse link expirou ou já foi usado. Peça um novo.');
    }
    this.props.emailVerificadoEm ??= agora;
    this.props.tokenHash = `${PREFIXO_TOKEN_CONSUMIDO}${this.props.id}`;
    this.props.tokenExpiraEm = null;
    this.props.atualizadoEm = agora;
  }

  /**
   * Anula o link pendente SEM confirmar o e-mail. Serve pro envio que falhou: o
   * link nunca chegou, e deixá-lo pendente faria o próximo pedido cair no limite
   * de reenvio por um link que ninguém recebeu. Mesmo valor do consumo, pelo mesmo
   * motivo (coluna UNIQUE NOT NULL).
   */
  invalidarLinkMagico(agora: Date): void {
    this.props.tokenHash = `${PREFIXO_TOKEN_CONSUMIDO}${this.props.id}`;
    this.props.tokenExpiraEm = null;
    this.props.atualizadoEm = agora;
  }

  /**
   * Quando o link atual foi emitido, deduzido da validade. null sem link pendente.
   * Serve pra não reenviar link a cada clique (limite por endereço).
   */
  linkEmitidoEm(validadeEmMinutos: number): Date | null {
    const expira = this.props.tokenExpiraEm;
    return expira === null ? null : new Date(expira.getTime() - validadeEmMinutos * 60_000);
  }

  descadastrar(agora: Date): void {
    if (!this.props.ativo) return;
    this.props.ativo = false;
    this.props.atualizadoEm = agora;
  }

  reativar(agora: Date): void {
    if (this.props.ativo) return;
    this.props.ativo = true;
    this.props.atualizadoEm = agora;
  }

  toSnapshot(): SubscriberProps {
    return structuredClone(this.props);
  }
}
