import { decodeCursor, encodeCursor, type Page, type PageRequest } from '../../../../shared/application/pagination';
import { BusinessRuleError, ConflictError } from '../../../../shared/domain/errors';
import type { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { isForeignKeyViolation, isUniqueViolation } from '../../../../shared/infra/database/prisma-errors';
import { competenciaValida, type CheckIn } from '../../domain/check-in';
import type { CheckInsRepository } from '../../domain/check-ins-repository';
import { toDomain, toPersistence } from './check-in.mapper';

const CHECK_IN_JA_EXISTE = 'Já existe um check-in desse mês.';
const CONTA_INEXISTENTE = 'Essa conta não existe mais.';

export class PrismaCheckInsRepository implements CheckInsRepository {
  constructor(private readonly db: PrismaDatabase) {}

  async findByCompetencia(subscriberId: string, competencia: string): Promise<CheckIn | null> {
    const row = await this.db.client.checkIn.findUnique({
      where: { subscriberId_competencia: { subscriberId, competencia } },
    });
    return row ? toDomain(row) : null;
  }

  async list(subscriberId: string, page: PageRequest): Promise<Page<CheckIn>> {
    const antesDe = decodeCursor(page.cursor, competenciaValida);
    const rows = await this.db.client.checkIn.findMany({
      // "AAAA-MM" tem tamanho e hífen fixos: a ordem de texto é a cronológica em qualquer collation
      where: { subscriberId, ...(antesDe === undefined ? {} : { competencia: { lt: antesDe } }) },
      // competência é única por pessoa: não há empate a desempatar
      orderBy: { competencia: 'desc' },
      // um a mais só pra saber se existe próxima página
      take: page.limit + 1,
    });
    const items = rows.slice(0, page.limit);
    const ultimo = items.at(-1);
    return {
      items: items.map(toDomain),
      nextCursor: rows.length > page.limit && ultimo ? encodeCursor(ultimo.competencia) : null,
    };
  }

  async save(checkIn: CheckIn): Promise<void> {
    const data = toPersistence(checkIn);
    try {
      await this.db.client.checkIn.upsert({
        where: { id: data.id },
        create: data,
        // só a resposta: enviadoEm é do claimSend/releaseSendClaim, e uma entidade lida
        // antes da reserva do job gravaria enviadoEm = null por cima dela
        update: {
          rendaReal: data.rendaReal,
          gastoReal: data.gastoReal,
          guardadoReal: data.guardadoReal,
          respondidoEm: data.respondidoEm,
        },
      });
    } catch (error) {
      // converte e relança: nada é engolido, seguro dentro de TransactionManager.run
      if (isUniqueViolation(error)) throw new ConflictError(CHECK_IN_JA_EXISTE);
      if (isForeignKeyViolation(error)) throw new BusinessRuleError(CONTA_INEXISTENTE);
      throw error;
    }
  }

  async claimSend(checkInId: string, sentAt: Date): Promise<boolean> {
    // o WHERE em enviadoEm é o compare-and-set: duas execuções do job disputam a
    // mesma linha e só uma encontra o valor nulo. O PGlite (uma sessão) não reproduz
    // a corrida; a garantia é do banco.
    const { count } = await this.db.client.checkIn.updateMany({
      where: { id: checkInId, enviadoEm: null },
      data: { enviadoEm: sentAt },
    });
    return count === 1;
  }

  async releaseSendClaim(checkInId: string): Promise<void> {
    // updateMany: id inexistente (conta excluída no meio) não vira erro
    await this.db.client.checkIn.updateMany({ where: { id: checkInId }, data: { enviadoEm: null } });
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    await this.db.client.checkIn.deleteMany({ where: { subscriberId } });
  }
}
