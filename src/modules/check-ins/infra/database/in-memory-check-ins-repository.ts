import { decodeCursor, encodeCursor, type Page, type PageRequest } from '../../../../shared/application/pagination';
import { BusinessRuleError, ConflictError } from '../../../../shared/domain/errors';
import { CheckIn, competenciaValida, type CheckInProps } from '../../domain/check-in';
import type { CheckInsRepository } from '../../domain/check-ins-repository';

/*
  Repositório em memória que se comporta como o Postgres (regras gerais em
  categorias/infra/database/in-memory-categorias-repository.ts):
  - guarda structuredClone do snapshot e devolve instâncias novas;
  - emula a unique (subscriberId, competencia) — é nela que o job e a resposta
    percebem a corrida — e a FK pro subscriber, por callback;
  - na atualização grava só a resposta, como o `update` do upsert do Prisma;
  - claimSend compara e grava sem nenhum await no meio: no event loop do Node,
    nada roda entre a comparação e a escrita — é o equivalente do WHERE;
  - ordena igual à consulta do Prisma: competência desc.

  O contrato (check-ins-repository.contract.ts) roda contra esta classe e
  contra a do Prisma.
*/

export interface InMemoryCheckInsOptions {
  /** "o subscriber existe?" — emula a FK; o container liga no repositório de subscribers */
  subscriberExists?: (subscriberId: string) => Promise<boolean>;
}

const CHECK_IN_JA_EXISTE = 'Já existe um check-in desse mês.';
const CONTA_INEXISTENTE = 'Essa conta não existe mais.';

export class InMemoryCheckInsRepository implements CheckInsRepository {
  private readonly rows = new Map<string, CheckInProps>();
  private readonly subscriberExists: (subscriberId: string) => Promise<boolean>;

  constructor(options: InMemoryCheckInsOptions = {}) {
    this.subscriberExists = options.subscriberExists ?? (async () => true);
  }

  private restore(props: CheckInProps): CheckIn {
    return CheckIn.restaurar(structuredClone(props));
  }

  async findByCompetencia(subscriberId: string, competencia: string): Promise<CheckIn | null> {
    const row = [...this.rows.values()].find((c) => c.subscriberId === subscriberId && c.competencia === competencia);
    return row ? this.restore(row) : null;
  }

  async list(subscriberId: string, page: PageRequest): Promise<Page<CheckIn>> {
    const antesDe = decodeCursor(page.cursor, competenciaValida);
    // "AAAA-MM" compara certo como texto; competência é única por pessoa, sem empate
    const rows = [...this.rows.values()]
      .filter((c) => c.subscriberId === subscriberId && (antesDe === undefined || c.competencia < antesDe))
      .sort((a, b) => (a.competencia < b.competencia ? 1 : a.competencia > b.competencia ? -1 : 0));
    const items = rows.slice(0, page.limit);
    const ultimo = items.at(-1);
    return {
      items: items.map((c) => this.restore(c)),
      nextCursor: rows.length > page.limit && ultimo ? encodeCursor(ultimo.competencia) : null,
    };
  }

  async save(checkIn: CheckIn): Promise<void> {
    const props = checkIn.toSnapshot();
    const atual = this.rows.get(props.id);
    if (atual) {
      // só a resposta, como o `update` do Prisma: enviadoEm é do claimSend/releaseSendClaim
      this.rows.set(props.id, {
        ...atual,
        rendaReal: props.rendaReal,
        gastoReal: props.gastoReal,
        guardadoReal: props.guardadoReal,
        respondidoEm: props.respondidoEm,
      });
      return;
    }
    // FK antes (tem await); a unique e a escrita depois, sem await no meio
    if (!(await this.subscriberExists(props.subscriberId))) throw new BusinessRuleError(CONTA_INEXISTENTE);
    const colide = [...this.rows.values()].some(
      (c) => c.subscriberId === props.subscriberId && c.competencia === props.competencia,
    );
    if (colide) throw new ConflictError(CHECK_IN_JA_EXISTE);
    this.rows.set(props.id, structuredClone(props));
  }

  async claimSend(checkInId: string, sentAt: Date): Promise<boolean> {
    const row = this.rows.get(checkInId);
    if (!row || row.enviadoEm !== null) return false;
    row.enviadoEm = new Date(sentAt);
    return true;
  }

  async releaseSendClaim(checkInId: string): Promise<void> {
    const row = this.rows.get(checkInId);
    if (row) row.enviadoEm = null;
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.subscriberId === subscriberId) this.rows.delete(id);
    }
  }
}
