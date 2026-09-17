/*
  Portas: o que a aplicação precisa do mundo lá fora, sem saber quem entrega.

  Casos de uso recebem estas interfaces no construtor. As implementações de
  verdade ficam em shared/infra; as de teste (relógio fixo, ids sequenciais,
  e-mail em memória) em shared/infra/in-memory.
*/

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

/**
 * Unidade de trabalho. Tudo que os repositórios fizerem dentro de `run` é
 * atômico: ou grava tudo, ou nada. Chamadas aninhadas reaproveitam a
 * transação de fora.
 */
export interface TransactionManager {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/** Tokens assinados: sessão (login) e descadastro (link do rodapé do e-mail). */
export interface AuthTokenService {
  issueSession(subscriberId: string): IssuedToken;
  /** null quando inválido, expirado ou de outro propósito */
  verifySession(token: string): { subscriberId: string } | null;
  issueUnsubscribe(subscriberId: string): IssuedToken;
  verifyUnsubscribe(token: string): { subscriberId: string } | null;
}

/**
 * A conta de uma sessão ainda existe? O JWT não é revogável e a exclusão (LGPD)
 * é física: sem esta checagem, o outro aparelho da pessoa seguia autenticado e
 * recriava dados de uma conta apagada. Descadastro (ativo=false) NÃO encerra sessão.
 */
export interface SessionAccounts {
  exists(subscriberId: string): Promise<boolean>;
}

/**
 * Token aleatório de uso único (link mágico). Só o hash vai pro banco: quem
 * lê a tabela não consegue entrar na conta de ninguém.
 */
export interface SecureTokenGenerator {
  generate(): string;
  hash(token: string): string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}
