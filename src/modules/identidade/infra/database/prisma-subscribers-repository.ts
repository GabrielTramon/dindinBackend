import { encodeCursor, type Page, type PageRequest } from '../../../../shared/application/pagination';
import { ConflictError } from '../../../../shared/domain/errors';
import type { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { isUniqueViolation } from '../../../../shared/infra/database/prisma-errors';
import type { Subscriber } from '../../domain/subscriber';
import type { SubscribersRepository } from '../../domain/subscribers-repository';
import { toDomain, toPersistence } from './subscriber.mapper';
import { clampPageLimit, decodeSubscriberCursor } from './subscribers-pagination';

export class PrismaSubscribersRepository implements SubscribersRepository {
  constructor(private readonly db: PrismaDatabase) {}

  async findById(id: string): Promise<Subscriber | null> {
    const row = await this.db.client.subscriber.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<Subscriber | null> {
    // igualdade exata: o e-mail já chega normalizado (minúsculo) e é gravado assim
    const row = await this.db.client.subscriber.findUnique({ where: { email } });
    return row ? toDomain(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<Subscriber | null> {
    const row = await this.db.client.subscriber.findUnique({ where: { token: tokenHash } });
    return row ? toDomain(row) : null;
  }

  async save(subscriber: Subscriber): Promise<void> {
    const { id, ...data } = toPersistence(subscriber);
    try {
      await this.db.client.subscriber.upsert({ where: { id }, create: { id, ...data }, update: data });
    } catch (error) {
      // unique de email (corrida entre dois pedidos) ou de token (hash repetido de 256 bits aleatórios:
      // na prática, nunca). Com driver adapter o P2002 não diz qual coluna — mesma mensagem pras duas.
      if (isUniqueViolation(error)) {
        throw new ConflictError('Já existe uma conta com esse e-mail.', { email: 'E-mail já cadastrado' });
      }
      throw error;
    }
  }

  async saveMagicLinkConsumption(subscriber: Subscriber, usedTokenHash: string): Promise<boolean> {
    const s = toPersistence(subscriber);
    // o WHERE no token é o compare-and-set: dois cliques simultâneos no mesmo link
    // disputam a mesma linha e só um encontra o hash antigo. Só os campos do consumo
    // entram no SET — ativo e e-mail gravados por outro pedido ficam como estão.
    const { count } = await this.db.client.subscriber.updateMany({
      where: { id: s.id, token: usedTokenHash },
      data: {
        token: s.token,
        tokenExpiraEm: s.tokenExpiraEm,
        emailVerificadoEm: s.emailVerificadoEm,
        atualizadoEm: s.atualizadoEm,
      },
    });
    return count === 1;
  }

  async delete(id: string): Promise<void> {
    // deleteMany em vez de delete + captura do P2025: inexistente não vira erro nenhum,
    // e nada é capturado — seguro dentro de TransactionManager.run
    await this.db.client.subscriber.deleteMany({ where: { id } });
  }

  async listEmailable(page: PageRequest): Promise<Page<Subscriber>> {
    const depoisDe = decodeSubscriberCursor(page.cursor);
    const limit = clampPageLimit(page.limit);
    const rows = await this.db.client.subscriber.findMany({
      where: {
        ativo: true,
        emailVerificadoEm: { not: null },
        ...(depoisDe === undefined ? {} : { id: { gt: depoisDe } }),
      },
      orderBy: { id: 'asc' },
      // um a mais só pra saber se existe próxima página
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map(toDomain);
    const ultimo = items.at(-1);
    return { items, nextCursor: rows.length > limit && ultimo ? encodeCursor(ultimo.id) : null };
  }
}
