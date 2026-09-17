import { UnauthorizedError } from '../../../shared/domain/errors';
import { ensure } from '../../../shared/domain/guards';

/*
  Quem deixou o e-mail. Sem senha: a identidade é provada pelo link mágico.

  Ciclo do token:
    emitirLinkMagico   → guarda o hash e a validade (o token em si só vai no e-mail)
    consumirLinkMagico → confere a validade, confirma o e-mail e troca o hash por
                         `consumido:<id>`: o link não funciona duas vezes

  Por que `consumido:<id>` e não uma constante: a coluna `token` é UNIQUE NOT NULL.
  Uma constante colidiria no login da segunda pessoa. O id é chave primária,
  então o valor é único; e o ":" não existe no alfabeto hex do SHA-256, então
  nenhum token chega nesse valor.

  Uso único SOB CONCORRÊNCIA não é garantido aqui (dois cliques simultâneos
  leem o mesmo hash): é o `saveMagicLinkConsumption` do repositório, com
  compare-and-set no banco.
*/

export const PREFIXO_TOKEN_CONSUMIDO = 'consumido:';

export interface SubscriberProps {
  id: string;
  email: string;
  /** SHA-256 do token do link mágico (coluna `token`) */
  tokenHash: string;
  tokenExpiraEm: Date | null;
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

  static criar(input: { id: string; email: string; tokenHash: string; tokenExpiraEm: Date; agora: Date }): Subscriber {
    return new Subscriber({
      id: input.id,
      email: normalizarEmail(input.email),
      tokenHash: input.tokenHash,
      tokenExpiraEm: input.tokenExpiraEm,
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
  get emailVerificadoEm() { return this.props.emailVerificadoEm; }
  get ativo() { return this.props.ativo; }
  get criadoEm() { return this.props.criadoEm; }
  get atualizadoEm() { return this.props.atualizadoEm; }

  /** Só manda e-mail pra quem confirmou o endereço e não se descadastrou. */
  get podeReceberEmail(): boolean {
    return this.props.ativo && this.props.emailVerificadoEm !== null;
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
