import type {
  Clock,
  EmailMessage,
  IdGenerator,
  Mailer,
  SecureTokenGenerator,
  SessionAccounts,
  TransactionManager,
} from '../../application/ports';

/*
  Implementações em memória das portas compartilhadas.

  Servem aos testes e ao modo PERSISTENCIA=memoria (subir a API sem Postgres).
  Não são mocks: se comportam como a coisa real, só que sem I/O.
*/

/** Relógio que só anda quando você manda. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-09-17T12:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date | string): void {
    this.current = new Date(date);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** ids previsíveis: "id-1", "id-2"… — asserções legíveis nos testes. */
export class SequentialIdGenerator implements IdGenerator {
  private next = 1;

  constructor(private readonly prefix = 'id') {}

  generate(): string {
    return `${this.prefix}-${this.next++}`;
  }
}

/**
 * Executa o trabalho direto. Não há rollback: repositórios em memória não são
 * transacionais. Teste de atomicidade de verdade é no Postgres.
 */
export class InMemoryTransactionManager implements TransactionManager {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

/** Guarda o que foi "enviado" pra o teste inspecionar. */
export class InMemoryMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  /** faça o próximo envio falhar */
  failNext = false;

  async send(message: EmailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('falha simulada de envio');
    }
    this.sent.push(message);
  }

  last(): EmailMessage | undefined {
    return this.sent.at(-1);
  }
}

/** Toda conta existe, até o teste dizer que foi excluída. */
export class InMemorySessionAccounts implements SessionAccounts {
  private readonly deleted = new Set<string>();

  markDeleted(subscriberId: string): void {
    this.deleted.add(subscriberId);
  }

  async exists(subscriberId: string): Promise<boolean> {
    return !this.deleted.has(subscriberId);
  }
}

/** Tokens previsíveis e hash reversível de olho: "token-1" → "hash(token-1)". */
export class PredictableSecureTokenGenerator implements SecureTokenGenerator {
  private next = 1;

  generate(): string {
    return `token-${this.next++}`;
  }

  hash(token: string): string {
    return `hash(${token})`;
  }
}
