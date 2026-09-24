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

/** O que um token de sessão diz, depois de conferidas a assinatura e a validade. */
export interface SessionClaims {
  subscriberId: string;
  /**
   * A versão das sessões da conta quando este token saiu. Ela sobe a cada senha
   * nova (Subscriber.versaoSessao): token de versão velha não vale mais.
   */
  versao: number;
}

/** Tokens assinados: sessão (login) e descadastro (link do rodapé do e-mail). */
export interface AuthTokenService {
  /** @param versao a versaoSessao da conta agora — é ela que uma senha nova invalida */
  issueSession(subscriberId: string, versao: number): IssuedToken;
  /** null quando inválido, expirado ou de outro propósito */
  verifySession(token: string): SessionClaims | null;
  issueUnsubscribe(subscriberId: string): IssuedToken;
  verifyUnsubscribe(token: string): { subscriberId: string } | null;
}

/**
 * A sessão ainda vale? O JWT não é revogável sozinho, então cada requisição
 * autenticada pergunta aqui:
 * - a conta existe? A exclusão (LGPD) é física: sem isto, o outro aparelho da
 *   pessoa seguia autenticado e recriava dados de uma conta apagada;
 * - a senha mudou depois que o token saiu? Redefinir ou trocar a senha sobe a
 *   versão das sessões, e os tokens de antes (o de quem roubou a senha, ou o de
 *   quem criou a conta com o e-mail de outra pessoa) deixam de valer.
 *
 * Descadastro (ativo=false) NÃO encerra sessão.
 */
export interface SessionAccounts {
  /** a versão atual das sessões da conta; null quando a conta não existe mais */
  sessionVersion(subscriberId: string): Promise<number | null>;
}

/**
 * Trabalho que roda DEPOIS da resposta, fora do caminho dela. É o e-mail do
 * "Esqueci a senha": esperar por ele deixaria o tempo de resposta (e a falha do
 * provedor, que virava 500 só pra quem tem conta) contar quais e-mails têm
 * conta. Falha vai pro log, nunca pra quem pediu.
 */
export interface BackgroundJobs {
  /** agenda e volta na hora, sem rodar nada do trabalho; `nome` identifica a tarefa no log */
  run(nome: string, trabalho: () => Promise<void>): void;
  /** resolve quando não houver tarefa em andamento (encerramento do servidor e testes) */
  idle(): Promise<void>;
}

/**
 * Token aleatório de uso único (os links do e-mail: confirmar o endereço, criar
 * senha nova). Só o hash vai pro banco: quem lê a tabela não consegue entrar na
 * conta de ninguém.
 */
export interface SecureTokenGenerator {
  generate(): string;
  hash(token: string): string;
}

/**
 * Hash de senha: lento de propósito e com sal por senha, pra um vazamento da
 * tabela não virar lista de senhas. A senha entra como a pessoa digitou — sem
 * trim, sem normalização.
 */
export interface PasswordHasher {
  /** o hash, num formato que carrega os próprios parâmetros (ver ScryptPasswordHasher) */
  hash(senha: string): Promise<string>;
  /** false também quando o hash está malformado: nunca lança por causa da entrada */
  verify(senha: string, hash: string): Promise<boolean>;
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
