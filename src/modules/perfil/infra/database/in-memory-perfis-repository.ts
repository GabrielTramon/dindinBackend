import { Perfil, type PerfilProps } from '../../domain/perfil';
import type { PerfisRepository } from '../../domain/perfis-repository';
import { contaInexistente } from './perfis-repository-errors';

/*
  Repositório em memória que se comporta como o Postgres (mesmas regras de
  categorias/infra/database/in-memory-categorias-repository.ts): guarda cópias
  profundas e emula a constraint de que o caso de uso depende.

  - chave = subscriberId: save de novo substitui a linha, como o upsert;
  - FK profiles.subscriber_id → UnauthorizedError, conferida só no INSERT
    (a linha existente já aponta pra uma conta válida). Entra por callback,
    que o container liga no repositório de subscribers.

  Não emula o cascade de gastos e dívidas no delete: quem apaga o perfil
  (exclusão LGPD) apaga os filhos antes, na ordem das FKs.

  O mesmo contrato (perfis-repository.contract.ts) roda contra esta classe e
  contra a do Prisma.
*/

export interface InMemoryPerfisOptions {
  /** "a conta existe?" — padrão: sempre */
  subscriberExists?: (subscriberId: string) => Promise<boolean>;
}

export class InMemoryPerfisRepository implements PerfisRepository {
  private readonly rows = new Map<string, PerfilProps>();
  private readonly subscriberExists: (subscriberId: string) => Promise<boolean>;

  constructor(options: InMemoryPerfisOptions = {}) {
    this.subscriberExists = options.subscriberExists ?? (async () => true);
  }

  async findBySubscriberId(subscriberId: string): Promise<Perfil | null> {
    const row = this.rows.get(subscriberId);
    return row ? Perfil.restaurar(structuredClone(row)) : null;
  }

  async exists(subscriberId: string): Promise<boolean> {
    return this.rows.has(subscriberId);
  }

  async save(perfil: Perfil): Promise<void> {
    const props = perfil.toSnapshot();
    if (!this.rows.has(props.subscriberId) && !(await this.subscriberExists(props.subscriberId))) {
      throw contaInexistente();
    }
    this.rows.set(props.subscriberId, structuredClone(props));
  }

  async delete(subscriberId: string): Promise<void> {
    this.rows.delete(subscriberId);
  }
}
